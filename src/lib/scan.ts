// Scan shapes returned by /api/scans (shared by server and pages). Plan §4.2, §4.4.

/** Pipeline stages in plan §4.2 order. Index = stage number. */
export const SCAN_STAGES = [
	'Acquire',
	'Static analysis',
	'Git mining',
	'Signals + criticality',
	'Components',
	'AI overview',
	'Docs',
	'Search index'
] as const;

/** Stages that are implemented so far, in run order. A scan is `done` once all of these finish. */
export const IMPLEMENTED_STAGES: readonly number[] = [0, 1, 2, 3, 4, 5];

export type ScanStatus = 'queued' | 'running' | 'done' | 'failed';
export type ReferenceScope = 'repo' | 'subpath';

/** Stage 0 file inventory, from `git ls-tree` (no blobs fetched). */
export interface InventoryStats {
	/** Files in the reference scope (the whole repo unless restricted). */
	files: number;
	deepFiles: number;
	/** Deep-scope file count per language. */
	deepLanguages: Record<string, number>;
}

/** Stage 2 git mining, over the deep scope's history. */
export interface GitStats {
	/** Non-merge commits touching the deep scope. */
	commits: number;
	bugfixCommits: number;
	reverts: number;
	/** Commit messages stating a hardware/timing reason (keyword heuristic). */
	rationaleCommits: number;
	authors: number;
	/** Historical blobs fetched in the batch prefetch (0 when already local). */
	blobsFetched: number;
	blamedFiles: number;
	blameFailures: number;
	blameRanges: number;
	coChangePairs: number;
	ms: { log: number; fetch: number; blame: number; total: number };
}

/** Stage 1: structure + reference index. */
export interface StructureStats {
	filesParsed: number;
	parseFailures: number;
	/** Files whose braces didn't balance: their symbol ranges are unreliable. */
	unbalanced: number;
	symbols: number;
	functions: number;
	classes: number;
	macros: number;
	edges: { resolved: number; ambiguous: number; unresolved: number };
	/** Source files outside the deep scope indexed for references. */
	referenceFiles: number;
	/** Of those, files that include or name something in the deep scope. */
	boundaryFiles: number;
	/** Call sites to names defined nowhere in the deep scope (libraries, HAL). */
	externalCalls: number;
	ms: number;
}

/** Stage 3: embedded signals + criticality. */
export interface SignalStats {
	total: number;
	byKind: Record<string, number>;
	highFunctions: number;
	ms: number;
}

export interface ComponentStats {
	components: number;
}

export interface ScanStats extends InventoryStats {
	structure?: StructureStats;
	git?: GitStats;
	signals?: SignalStats;
	components?: ComponentStats;
}

export interface ScanSummary {
	id: string;
	snapshotId: string;
	repo: string;
	ref: string;
	commit: string;
	/** Repo-relative path, `''` = whole repo. */
	deepScope: string;
	referenceScope: ReferenceScope;
	status: ScanStatus;
	/** Stage currently running, or the last one reached. */
	stage: number;
	error: string | null;
	tokensUsed: number;
	stats: ScanStats | null;
	createdAt: string;
	finishedAt: string | null;
}
