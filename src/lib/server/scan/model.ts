// Loads a snapshot's stored model for Tabs 1–3 (views in `views.ts`), and Ask-the-author lookups.
// A snapshot's rows are immutable once stored, so each is loaded once and kept in memory.

import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import type { Person } from '$lib/claims';
import type { Authorship, Fence } from '$lib/model';
import { db } from '$lib/server/db';
import {
	blameRange,
	codeSignal,
	codeSymbol,
	component,
	edge,
	fileHistory,
	fileModel,
	gitAuthor,
	gitCommit,
	scanRun,
	snapshot
} from '$lib/server/db/schema';
import { commitAuthorLogin } from '$lib/server/github';
import type { Llm } from '$lib/server/llm/core';
import { readFence } from './fence-reading';
import { fencesOf, forgetFences } from './fences';
import { git } from './git';
import { lineHistory } from './gitmine';
import { blameAt, person, type SnapshotView } from './views';

export { graphData, impactOf, nodeDetails, onboardingPack, packMarkdown, reachOf } from './views';

const DATA_DIR = env.DATA_DIR || 'data';
const cache = new Map<string, SnapshotView>();

/** Drop a deleted snapshot's in-memory model. */
export function forgetSnapshot(snapId: string) {
	cache.delete(snapId);
	forgetFences(snapId);
}

const cloneDir = (m: SnapshotView) => join(DATA_DIR, 'repos', `${m.repo}.git`);

/** "What not to break" for a loaded snapshot (traced in the clone once, then kept). */
export function fences(m: SnapshotView, token: string) {
	return fencesOf(m, cloneDir(m), { token });
}

/** The first `lines` lines of each file at the snapshot (header comments, includes, declarations). */
export async function fileHeads(m: SnapshotView, paths: string[], lines = 40) {
	const heads = new Map<string, string>();
	for (const path of paths) {
		const text = await git(['show', `${m.commit}:${path}`], { cwd: cloneDir(m) }).catch(() => '');
		if (text) heads.set(path, text.split('\n').slice(0, lines).join('\n'));
	}
	return heads;
}

/** The model's reading of one fence (cached by input hash in `llm_call`). */
export function fenceReading(m: SnapshotView, fence: Fence, model: Llm) {
	return readFence(fence, m, cloneDir(m), model);
}

/** The finished scan's snapshot model, for this user. */
/** `unfinished`: also while the scan runs (its last stage reads the stored model). */
export function loadModel(userId: string, scanId: string, unfinished = false): SnapshotView {
	const row = db
		.select({ run: scanRun, snap: snapshot })
		.from(scanRun)
		.innerJoin(snapshot, eq(scanRun.snapshotId, snapshot.id))
		.where(and(eq(scanRun.id, scanId), eq(scanRun.userId, userId)))
		.get();
	if (!row) error(404, 'Scan not found');
	if (!unfinished && row.run.status !== 'done') error(409, `Scan is ${row.run.status}`);
	const snapId = row.snap.id;
	const hit = cache.get(snapId);
	if (hit) return hit;
	const view: SnapshotView = {
		snapId,
		repo: row.snap.repo,
		commit: row.snap.commitSha,
		deepScope: row.snap.deepScope,
		stats: row.run.stats,
		files: db.select().from(fileModel).where(eq(fileModel.snapshotId, snapId)).all(),
		symbols: db.select().from(codeSymbol).where(eq(codeSymbol.snapshotId, snapId)).all(),
		signals: db.select().from(codeSignal).where(eq(codeSignal.snapshotId, snapId)).all(),
		components: db.select().from(component).where(eq(component.snapshotId, snapId)).all(),
		edges: db.select().from(edge).where(eq(edge.snapshotId, snapId)).all(),
		commits: new Map(
			db
				.select()
				.from(gitCommit)
				.where(eq(gitCommit.snapshotId, snapId))
				.all()
				.map((c) => [c.sha, c])
		),
		history: new Map(
			db
				.select()
				.from(fileHistory)
				.where(eq(fileHistory.snapshotId, snapId))
				.all()
				.map((h) => [h.path, h])
		),
		blame: db.select().from(blameRange).where(eq(blameRange.snapshotId, snapId)).all(),
		authors: new Map(
			db
				.select()
				.from(gitAuthor)
				.where(eq(gitAuthor.snapshotId, snapId))
				.all()
				.map((a) => [a.email, a])
		)
	};
	cache.set(snapId, view);
	return view;
}

/** Plan §3 rule 3: last modified by (blame) and introduced by (best effort, `git log -L`). */
export async function authorship(
	m: SnapshotView,
	token: string,
	path: string,
	line: number
): Promise<Authorship> {
	const last = blameAt(m, path, line);
	const [owner, name] = m.repo.split('/');
	const withLogin = async (p: Person | null) => {
		if (!p || p.login) return p;
		const gh = await commitAuthorLogin(token, owner, name, p.sha).catch(() => null);
		return { ...p, login: gh?.login ?? null };
	};
	let introducedBy: Person | null = null;
	let introducedNote: string;
	try {
		const dir = join(DATA_DIR, 'repos', `${m.repo}.git`);
		const h = await lineHistory(dir, m.commit, path, line, line, 20);
		const e = h.entries.find((x) => x.sha === h.introducedBy);
		if (e) {
			introducedBy = {
				name: e.authorName,
				email: e.authorEmail,
				sha: e.sha,
				date: new Date(e.authoredAt).toISOString(),
				subject: e.subject
			};
			introducedNote = h.truncated
				? 'Oldest commit found within the traced history.'
				: 'First commit that added this line with its current text.';
		} else {
			introducedNote =
				'Unknown: history too tangled (moved or reformatted) to find where this line came from.';
		}
	} catch {
		introducedNote = 'Unknown: line history unavailable.';
	}
	return {
		path,
		line,
		commit: m.commit,
		lastModifiedBy: await withLogin(last ? person(m, last.sha) : null),
		introducedBy: await withLogin(introducedBy),
		introducedNote
	};
}
