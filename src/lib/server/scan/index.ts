import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import type { InventoryStats, ReferenceScope, ScanStats, ScanSummary } from '$lib/scan';
import { IMPLEMENTED_STAGES } from '$lib/scan';
import { db } from '$lib/server/db';
import { scanFile, scanRun, snapshot } from '$lib/server/db/schema';
import { getRepo, parseRepo, resolveCommit } from '$lib/server/github';
import { enqueue } from '$lib/server/jobs/queue';
import { yielder } from '$lib/server/jobs/yield';
import { ensureCommit, inScope, languageOf, listTree } from './acquire';
import { llm } from '$lib/server/llm';
import { loadModel } from './model';
import { scanOverview } from './overview';
import { analyzeSnapshot } from './pipeline';
import { PARSER_VERSION, configHash, normalizeScope, snapshotId } from './snapshot';
import { storeModel } from './store';
import { SOURCE_LANGUAGES } from './structure';

const DATA_DIR = env.DATA_DIR || 'data';

/**
 * Deep analysis (blame + line history of every file) is meant for one subsystem. ArduPilot's
 * `libraries/AP_InertialSensor` is 59 files and takes ~20 s; the whole repo (3.4k files, 74k
 * commits) would take the better part of an hour. The rest of the repo is still indexed.
 */
const MAX_DEEP_SOURCES = 500;

/** Biggest sub-directories of the deep scope, as subpath suggestions. */
function largestDirs(sources: { path: string }[], deepScope: string): string {
	const depth = (deepScope ? deepScope.split('/').length : 0) + 2;
	const counts = new Map<string, number>();
	for (const f of sources) {
		const parts = f.path.split('/');
		if (parts.length <= depth) continue;
		const dir = parts.slice(0, depth).join('/');
		counts.set(dir, (counts.get(dir) ?? 0) + 1);
	}
	return (
		[...counts]
			.filter(([, n]) => n <= MAX_DEEP_SOURCES)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([dir, n]) => `${dir} (${n} files)`)
			.join(', ') || 'a subdirectory'
	);
}

export interface NewScan {
	repo: string;
	ref?: string;
	subpath?: string;
	referenceScope?: ReferenceScope;
}

/**
 * Plan §6.2 `POST /api/scans`: pin the ref to a commit, record the snapshot, queue the run.
 * The token only lives in memory for the job; it's never stored with the scan.
 */
export async function createScan(userId: string, token: string, input: NewScan) {
	const parsed = parseRepo(input.repo ?? '');
	if (!parsed) error(400, 'repo must be "owner/name" or a github.com URL');

	let deepScope: string;
	try {
		deepScope = normalizeScope(input.subpath);
	} catch (e) {
		error(400, (e as Error).message);
	}
	const referenceScope: ReferenceScope = input.referenceScope === 'subpath' ? 'subpath' : 'repo';

	const repo = await getRepo(token, parsed.owner, parsed.name);
	const ref = input.ref?.trim() || repo.defaultBranch;
	const commitSha = await resolveCommit(token, repo.owner, repo.name, ref);

	const identity = {
		repo: repo.fullName,
		commitSha,
		deepScope,
		referenceScope,
		configHash: configHash(),
		parserVersion: PARSER_VERSION
	};
	const snapId = snapshotId(identity);
	const scanId = crypto.randomUUID();

	db.transaction((tx) => {
		tx.insert(snapshot)
			.values({ id: snapId, ...identity })
			.onConflictDoNothing()
			.run();
		tx.insert(scanRun).values({ id: scanId, snapshotId: snapId, userId, ref }).run();
	});

	enqueue(() => runScan(scanId, token));
	return { scanId, snapshotId: snapId };
}

async function runScan(scanId: string, token: string) {
	const setRun = (values: Partial<typeof scanRun.$inferInsert>) =>
		db.update(scanRun).set(values).where(eq(scanRun.id, scanId)).run();

	try {
		const [snap] = await db
			.select()
			.from(snapshot)
			.innerJoin(scanRun, eq(scanRun.snapshotId, snapshot.id))
			.where(eq(scanRun.id, scanId));
		if (!snap) return;
		const { repo, commitSha, deepScope, referenceScope } = snap.snapshot;

		// Same snapshot (commit + scopes + config + parser) already analysed: the model is
		// deterministic, so reuse it instead of redoing a minute of work (plan §4, "scan once").
		const previous = db
			.select({ stats: scanRun.stats })
			.from(scanRun)
			.where(
				and(
					eq(scanRun.snapshotId, snap.snapshot.id),
					eq(scanRun.status, 'done'),
					ne(scanRun.id, scanId)
				)
			)
			.orderBy(desc(scanRun.finishedAt))
			.get();
		if (previous) {
			setRun({
				status: 'done',
				stage: IMPLEMENTED_STAGES[IMPLEMENTED_STAGES.length - 1],
				stats: previous.stats,
				finishedAt: new Date()
			});
			return;
		}

		// Stage 0: acquire + inventory.
		setRun({ status: 'running', stage: 0 });
		const dir = join(DATA_DIR, 'repos', `${repo}.git`);
		await ensureCommit({ url: `https://github.com/${repo}.git`, dir, commitSha, auth: { token } });

		const refScope = referenceScope === 'subpath' ? deepScope : '';
		const files = (await listTree(dir, commitSha))
			.filter((f) => inScope(f.path, refScope))
			.map((f) => ({
				...f,
				language: languageOf(f.path),
				inDeepScope: inScope(f.path, deepScope)
			}));

		const stats: InventoryStats = {
			files: 0,
			deepFiles: 0,
			deepLanguages: {}
		};
		for (const f of files) {
			stats.files++;
			if (!f.inDeepScope) continue;
			stats.deepFiles++;
			stats.deepLanguages[f.language] = (stats.deepLanguages[f.language] ?? 0) + 1;
		}
		if (stats.deepFiles === 0) {
			throw new Error(`Subpath "${deepScope}" has no files at ${commitSha.slice(0, 7)}`);
		}
		const deepSources = files.filter((f) => f.inDeepScope && SOURCE_LANGUAGES.has(f.language));
		if (deepSources.length === 0) {
			const found = Object.entries(stats.deepLanguages)
				.sort((a, b) => b[1] - a[1])
				.map(([lang, n]) => `${n} ${lang}`)
				.join(', ');
			throw new Error(
				`No C/C++ source files in ${deepScope ? `"${deepScope}"` : 'the repo'} (found ${found}). ` +
					'This tool analyses embedded C/C++ code; pick a repo or subpath that contains some.'
			);
		}
		if (deepSources.length > MAX_DEEP_SOURCES) {
			throw new Error(
				`The deep scope ${deepScope ? `"${deepScope}"` : '(whole repo)'} has ${deepSources.length} C/C++ files; ` +
					`the limit is ${MAX_DEEP_SOURCES}. Pick a subsystem as the subpath (e.g. ${largestDirs(deepSources, deepScope)}). ` +
					'The rest of the repo is still indexed for references.'
			);
		}

		const snapId = snap.snapshot.id;
		// Same snapshot scanned again: inventory is identical, keep the existing rows.
		const [{ n }] = db
			.select({ n: sql<number>`count(*)` })
			.from(scanFile)
			.where(eq(scanFile.snapshotId, snapId))
			.all();
		if (n === 0) {
			const tick = yielder();
			for (let i = 0; i < files.length; i += 500) {
				const chunk = files.slice(i, i + 500);
				db.insert(scanFile)
					.values(chunk.map((f) => ({ snapshotId: snapId, ...f })))
					.run();
				await tick();
			}
		}

		setRun({ stats });

		// Stages 1–4 (deterministic, no LLM).
		const model = await analyzeSnapshot({
			dir,
			commitSha,
			deepScope,
			referenceScope: refScope,
			tree: files,
			auth: { token },
			onStage: (stage) => setRun({ stage })
		});
		await storeModel(snapId, model);
		const done: ScanStats = {
			...stats,
			...model.stats,
			git: model.history?.stats
		};

		// Stage 5: the wiki's AI overview, generated now so the wiki opens with it (cached by input
		// hash). Best effort: without a model, or when it fails, the wiki asks again on open.
		setRun({ stage: 5, stats: done });
		const ai = llm();
		if (ai) {
			const view = loadModel(snap.scan_run.userId, scanId, true);
			await scanOverview(view, scanId, token, ai).catch((e: Error) =>
				console.warn(`[scan ${scanId}] AI overview failed: ${e.message}`)
			);
		}

		setRun({
			status: 'done',
			stage: IMPLEMENTED_STAGES[IMPLEMENTED_STAGES.length - 1],
			stats: done,
			finishedAt: new Date()
		});
	} catch (err) {
		console.error(`[scan ${scanId}] failed`, err);
		setRun({ status: 'failed', error: (err as Error).message, finishedAt: new Date() });
	}
}

/** Jobs are in-memory: on server start, anything not finished was lost with the old process. */
export function markInterruptedScans() {
	db.update(scanRun)
		.set({
			status: 'failed',
			error: 'Server restarted before the scan finished',
			finishedAt: new Date()
		})
		.where(inArray(scanRun.status, ['queued', 'running']))
		.run();
}

const summaryColumns = { run: scanRun, snap: snapshot };

function toSummary({
	run,
	snap
}: {
	run: typeof scanRun.$inferSelect;
	snap: typeof snapshot.$inferSelect;
}): ScanSummary {
	return {
		id: run.id,
		snapshotId: snap.id,
		repo: snap.repo,
		ref: run.ref,
		commit: snap.commitSha,
		deepScope: snap.deepScope,
		referenceScope: snap.referenceScope,
		status: run.status,
		stage: run.stage,
		error: run.error,
		tokensUsed: run.tokensUsed,
		stats: run.stats,
		createdAt: run.createdAt.toISOString(),
		finishedAt: run.finishedAt?.toISOString() ?? null
	};
}

export async function listScans(userId: string, limit = 20): Promise<ScanSummary[]> {
	const rows = await db
		.select(summaryColumns)
		.from(scanRun)
		.innerJoin(snapshot, eq(scanRun.snapshotId, snapshot.id))
		.where(eq(scanRun.userId, userId))
		.orderBy(desc(scanRun.createdAt))
		.limit(limit);
	return rows.map(toSummary);
}

export async function getScan(userId: string, scanId: string): Promise<ScanSummary> {
	const [row] = await db
		.select(summaryColumns)
		.from(scanRun)
		.innerJoin(snapshot, eq(scanRun.snapshotId, snapshot.id))
		.where(and(eq(scanRun.id, scanId), eq(scanRun.userId, userId)));
	if (!row) error(404, 'Scan not found');
	return toSummary(row);
}
