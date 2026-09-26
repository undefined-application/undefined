// Stages 0b–4 as one pure-ish function over a clone + commit, so a scan and a PR review
// (which analyses the merge-base snapshot) run exactly the same analysis. No LLM here.

import type { ComponentStats, SignalStats, StructureStats } from '$lib/scan';
import type { CriticalityLevel } from '$lib/server/db/scan.schema';
import { yielder } from '$lib/server/jobs/yield';
import { inScope, languageOf, type TreeEntry } from './acquire';
import { buildComponents, type ComponentRow } from './components';
import { ensureBlobs, readBlobs, type GitAuth } from './git';
import { mineHistory, type MinedHistory } from './gitmine';
import {
	detectSignals,
	gitSignals,
	scoreSymbols,
	type Criticality,
	type Factor,
	type Signal
} from './signals';
import { buildStructure, SOURCE_LANGUAGES, type Structure } from './structure';

export interface ScoredComponent extends ComponentRow {
	criticality: number;
	level: CriticalityLevel;
}

export interface SnapshotModel {
	structure: Structure;
	history: MinedHistory | null;
	signals: Signal[];
	symbolScores: Map<string, Criticality>;
	fileScores: Map<string, Criticality>;
	components: ScoredComponent[];
	/** Deep-scope source texts at the commit. */
	sources: Map<string, string>;
	/** Test sources anywhere in the reference scope (for "related tests found", never "covered"). */
	testSources: Map<string, string>;
	stats: { structure: StructureStats; signals: SignalStats; components: ComponentStats };
}

export interface AnalyzeInput {
	dir: string;
	commitSha: string;
	deepScope: string;
	/** `''` = whole repo. */
	referenceScope: string;
	tree: TreeEntry[];
	auth?: GitAuth;
	/** Skip git mining (e.g. reviews that only need structure + signals). */
	withHistory?: boolean;
	onStage?: (stage: number) => void;
}

/** Unit/integration test sources: `tests/`, `test_*.cpp`, `*_test.c`. Examples are not tests. */
export const TEST_PATH = /(^|\/)(tests?|unittests?|gtest)\/|(^|\/)test_[^/]+$|_tests?\.(c|cc|cpp)$/;

const rank = <T extends { score: number; level: CriticalityLevel }>(
	items: T[],
	high = 0.1,
	medium = 0.35
) => {
	const ranked = items.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
	ranked.forEach((c, i) => {
		c.level =
			i < Math.ceil(ranked.length * high)
				? 'high'
				: i < Math.ceil(ranked.length * medium)
					? 'medium'
					: 'low';
	});
};

export async function analyzeSnapshot(input: AnalyzeInput): Promise<SnapshotModel> {
	const { dir, commitSha, deepScope, referenceScope, tree, auth, onStage } = input;

	// Stage 0b: fetch and read the current source blobs (deep scope + reference-scope C/C++).
	const t0 = Date.now();
	const isSource = (p: string) => SOURCE_LANGUAGES.has(languageOf(p));
	const deepEntries = tree.filter((f) => inScope(f.path, deepScope) && isSource(f.path));
	const refEntries = tree.filter(
		(f) => inScope(f.path, referenceScope) && !inScope(f.path, deepScope) && isSource(f.path)
	);
	await ensureBlobs(
		dir,
		[...deepEntries, ...refEntries].map((f) => f.blobSha),
		auth
	);
	const blobs = await readBlobs(
		dir,
		[...deepEntries, ...refEntries].map((f) => f.blobSha)
	);
	const sources = new Map(deepEntries.map((f) => [f.path, blobs.get(f.blobSha) ?? '']));
	const testSources = new Map(
		[...deepEntries, ...refEntries]
			.filter((f) => TEST_PATH.test(f.path))
			.map((f) => [f.path, blobs.get(f.blobSha) ?? ''])
	);

	// Stage 1: structure + reference index.
	onStage?.(1);
	const t1 = Date.now();
	const structure = await buildStructure({
		deep: deepEntries.map((f) => ({ path: f.path, text: sources.get(f.path)! })),
		reference: refEntries.map((f) => ({ path: f.path, text: blobs.get(f.blobSha) ?? '' })),
		allPaths: tree.map((f) => f.path)
	});
	const edgeStats = { resolved: 0, ambiguous: 0, unresolved: 0 };
	for (const e of structure.edges) edgeStats[e.resolution]++;
	const structureStats: StructureStats = {
		filesParsed: structure.files.filter((f) => f.parsed).length,
		parseFailures: structure.files.filter((f) => !f.parsed).length,
		unbalanced: structure.files.filter((f) => f.unbalanced).length,
		symbols: structure.symbols.length,
		functions: structure.symbols.filter((s) => s.kind === 'function').length,
		classes: structure.symbols.filter((s) => s.kind === 'class').length,
		macros: structure.symbols.filter((s) => s.kind === 'macro').length,
		edges: edgeStats,
		referenceFiles: refEntries.length,
		boundaryFiles: structure.boundary.length,
		externalCalls: structure.symbols.reduce((n, s) => n + s.externalCalls, 0),
		ms: Date.now() - t1 + (t1 - t0)
	};

	// Stage 2: git mining.
	let history: MinedHistory | null = null;
	if (input.withHistory !== false) {
		onStage?.(2);
		history = await mineHistory({
			dir,
			commitSha,
			deepScope,
			deepFiles: tree
				.filter((f) => inScope(f.path, deepScope))
				.map((f) => ({ path: f.path, language: languageOf(f.path) })),
			auth
		});
	}

	// Stage 3: signals + criticality.
	onStage?.(3);
	const t3 = Date.now();
	const tick = yielder();
	const byPath = <T extends { path: string }>(items: T[]) => {
		const m = new Map<string, T[]>();
		for (const x of items) {
			const list = m.get(x.path);
			if (list) list.push(x);
			else m.set(x.path, [x]);
		}
		return m;
	};
	const signals: Signal[] = [];
	const commitsBySha = new Map((history?.commits ?? []).map((c) => [c.sha, c]));
	const blameByPath = byPath(history?.blame ?? []);
	for (const [path, p] of structure.parsed) {
		await tick();
		signals.push(...detectSignals(path, sources.get(path)!, p));
		const blame = blameByPath.get(path);
		if (blame) signals.push(...gitSignals(path, p.blanked.code.split('\n'), blame, commitsBySha));
	}
	await tick();
	const symbolScores = scoreSymbols(structure.symbols, signals, structure.edges);

	const fileScores = new Map<string, Criticality>();
	const fnByFile = new Map<string, { name: string; c: Criticality }[]>();
	for (const s of structure.symbols) {
		const c = symbolScores.get(s.id);
		if (!c) continue;
		const list = fnByFile.get(s.path) ?? [];
		list.push({ name: s.name, c });
		fnByFile.set(s.path, list);
	}
	const fnRangesByPath = byPath(structure.symbols.filter((s) => s.kind === 'function'));
	const signalsByPath = byPath(signals);
	for (const f of structure.files) {
		await tick();
		const top = (fnByFile.get(f.path) ?? []).sort((a, b) => b.c.score - a.c.score).slice(0, 3);
		const factors: Factor[] = top
			.filter((t) => t.c.score > 0)
			.map((t) => ({ factor: 'function', points: t.c.score, detail: t.name }));
		const fnRanges = fnRangesByPath.get(f.path) ?? [];
		const loose = (signalsByPath.get(f.path) ?? []).filter(
			(s) =>
				(s.kind === 'workaround_comment' ||
					s.kind === 'timing_constant' ||
					s.kind === 'external_interface') &&
				!fnRanges.some((r) => r.start <= s.start && s.start <= r.end)
		);
		if (loose.length) {
			factors.push({
				factor: 'file_signals',
				points: Math.min(loose.length, 5),
				detail: `${loose.length} signals outside functions`
			});
		}
		const score = Math.round(factors.reduce((n, x) => n + x.points, 0) * 10) / 10;
		fileScores.set(f.path, { score, level: 'low', factors });
	}
	rank([...fileScores.values()]);
	const byKind: Record<string, number> = {};
	for (const s of signals) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
	const signalStats: SignalStats = {
		total: signals.length,
		byKind,
		highFunctions: [...symbolScores.values()].filter((c) => c.level === 'high').length,
		ms: Date.now() - t3
	};

	// Stage 4: components.
	onStage?.(4);
	const components: ScoredComponent[] = (
		await buildComponents(
			deepScope,
			structure.files.map((f) => f.path),
			structure.edges
		)
	).map((c) => ({
		...c,
		criticality: Math.max(0, ...c.files.map((f) => fileScores.get(f)?.score ?? 0)),
		level: 'low' as CriticalityLevel
	}));
	const compRank = components.map((c) => ({ score: c.criticality, level: c.level, c }));
	rank(compRank, 0.2, 0.5);
	for (const r of compRank) r.c.level = r.level;

	return {
		structure,
		history,
		signals,
		symbolScores,
		fileScores,
		components,
		sources,
		testSources,
		stats: {
			structure: structureStats,
			signals: signalStats,
			components: { components: components.length }
		}
	};
}
