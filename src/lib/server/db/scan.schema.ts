import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ReferenceScope, ScanStats, ScanStatus } from '$lib/scan';
import { user } from './auth.schema';

/** Plan §4.5.3: everything stored belongs to a snapshot. `id` = hash of all other identity fields. */
export const snapshot = sqliteTable('snapshot', {
	id: text('id').primaryKey(),
	repo: text('repo').notNull(),
	commitSha: text('commit_sha').notNull(),
	deepScope: text('deep_scope').notNull(),
	referenceScope: text('reference_scope').$type<ReferenceScope>().notNull(),
	configHash: text('config_hash').notNull(),
	parserVersion: text('parser_version').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull()
});

/** One run of the pipeline over a snapshot (plan §4.4 `ScanRun`). */
export const scanRun = sqliteTable(
	'scan_run',
	{
		id: text('id').primaryKey(),
		snapshotId: text('snapshot_id')
			.notNull()
			.references(() => snapshot.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** Ref as the user picked it (branch name); the snapshot pins the commit. */
		ref: text('ref').notNull(),
		status: text('status').$type<ScanStatus>().notNull().default('queued'),
		stage: integer('stage').notNull().default(0),
		error: text('error'),
		tokensUsed: integer('tokens_used').notNull().default(0),
		stats: text('stats', { mode: 'json' }).$type<ScanStats>(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		finishedAt: integer('finished_at', { mode: 'timestamp_ms' })
	},
	(table) => [index('scan_run_userId_idx').on(table.userId)]
);

/** Stage 0 inventory: every file in the reference scope at the snapshot commit. */
export const scanFile = sqliteTable(
	'scan_file',
	{
		snapshotId: text('snapshot_id')
			.notNull()
			.references(() => snapshot.id, { onDelete: 'cascade' }),
		path: text('path').notNull(),
		/** Git blob SHA = content hash, the parse-cache key (plan §4.5.4). */
		blobSha: text('blob_sha').notNull(),
		language: text('language').notNull(),
		inDeepScope: integer('in_deep_scope', { mode: 'boolean' }).notNull()
	},
	(table) => [primaryKey({ columns: [table.snapshotId, table.path] })]
);

export interface CriticalityFactor {
	factor: string;
	points: number;
	detail: string;
}
export type CriticalityLevel = 'high' | 'medium' | 'low';

/** Stage 1/3/4 per deep-scope source file: parse status, component and criticality rollup. */
export const fileModel = sqliteTable(
	'file_model',
	{
		snapshotId: text('snapshot_id')
			.notNull()
			.references(() => snapshot.id, { onDelete: 'cascade' }),
		path: text('path').notNull(),
		lines: integer('lines').notNull(),
		parsed: integer('parsed', { mode: 'boolean' }).notNull(),
		/** Braces didn't balance: symbol ranges in this file are unreliable. */
		unbalanced: integer('unbalanced', { mode: 'boolean' }).notNull(),
		parseError: text('parse_error'),
		component: text('component'),
		criticality: real('criticality').notNull().default(0),
		level: text('level').$type<CriticalityLevel>().notNull().default('low'),
		factors: text('factors', { mode: 'json' }).$type<CriticalityFactor[]>().notNull()
	},
	(table) => [primaryKey({ columns: [table.snapshotId, table.path] })]
);

/** Stage 1 symbols in the deep scope (plan §4.4 `Symbol`). Id: `sym:<path>#<qualified name>`. */
export const codeSymbol = sqliteTable(
	'code_symbol',
	{
		snapshotId: text('snapshot_id')
			.notNull()
			.references(() => snapshot.id, { onDelete: 'cascade' }),
		id: text('id').notNull(),
		path: text('path').notNull(),
		name: text('name').notNull(),
		shortName: text('short_name').notNull(),
		kind: text('kind').$type<'function' | 'class' | 'macro'>().notNull(),
		start: integer('start').notNull(),
		end: integer('end').notNull(),
		signature: text('signature').notNull(),
		className: text('class_name'),
		component: text('component'),
		externalCalls: integer('external_calls').notNull().default(0),
		criticality: real('criticality').notNull().default(0),
		level: text('level').$type<CriticalityLevel>().notNull().default('low'),
		factors: text('factors', { mode: 'json' }).$type<CriticalityFactor[]>().notNull()
	},
	(table) => [
		primaryKey({ columns: [table.snapshotId, table.id] }),
		index('code_symbol_path_idx').on(table.snapshotId, table.path),
		index('code_symbol_short_idx').on(table.snapshotId, table.shortName)
	]
);

/** Stage 3 embedded signals (plan §4.3, §4.4 `Signal`). Heuristic, citable evidence. */
export const codeSignal = sqliteTable(
	'code_signal',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		snapshotId: text('snapshot_id')
			.notNull()
			.references(() => snapshot.id, { onDelete: 'cascade' }),
		path: text('path').notNull(),
		start: integer('start').notNull(),
		end: integer('end').notNull(),
		kind: text('kind').notNull(),
		source: text('source').$type<'static' | 'comment' | 'git'>().notNull(),
		snippet: text('snippet').notNull(),
		detail: text('detail').notNull(),
		weight: real('weight').notNull(),
		symbolId: text('symbol_id')
	},
	(table) => [index('code_signal_path_idx').on(table.snapshotId, table.path)]
);

/** Stage 4 components (plan §4.4 `Component`). */
export const component = sqliteTable(
	'component',
	{
		snapshotId: text('snapshot_id')
			.notNull()
			.references(() => snapshot.id, { onDelete: 'cascade' }),
		id: text('id').notNull(),
		name: text('name').notNull(),
		files: text('files', { mode: 'json' }).$type<string[]>().notNull(),
		criticality: real('criticality').notNull().default(0),
		level: text('level').$type<CriticalityLevel>().notNull().default('low'),
		/** Stage 5 LLM summary (validated claims), once built. */
		summary: text('summary', { mode: 'json' }).$type<unknown>()
	},
	(table) => [primaryKey({ columns: [table.snapshotId, table.id] })]
);

/** Stage 2: commits touching the deep scope, plus any commit blame lands on (plan §4.4 `Commit`). */
export const gitCommit = sqliteTable(
	'git_commit',
	{
		snapshotId: text('snapshot_id')
			.notNull()
			.references(() => snapshot.id, { onDelete: 'cascade' }),
		sha: text('sha').notNull(),
		authorName: text('author_name').notNull(),
		authorEmail: text('author_email').notNull(),
		authoredAt: integer('authored_at', { mode: 'timestamp_ms' }).notNull(),
		subject: text('subject').notNull(),
		body: text('body').notNull(),
		bugfix: integer('bugfix', { mode: 'boolean' }).notNull(),
		revert: integer('revert', { mode: 'boolean' }).notNull(),
		/** Message states a hardware/timing reason (keyword heuristic). */
		rationale: integer('rationale', { mode: 'boolean' }).notNull(),
		revertOf: text('revert_of'),
		refs: text('refs', { mode: 'json' }).$type<number[]>().notNull(),
		/** Deep-scope paths at the snapshot commit (renames followed). Empty for blame-only commits. */
		files: text('files', { mode: 'json' }).$type<string[]>().notNull()
	},
	(table) => [primaryKey({ columns: [table.snapshotId, table.sha] })]
);

/** Stage 2 per-file history rollup, keyed by path at the snapshot commit. */
export const fileHistory = sqliteTable(
	'file_history',
	{
		snapshotId: text('snapshot_id')
			.notNull()
			.references(() => snapshot.id, { onDelete: 'cascade' }),
		path: text('path').notNull(),
		commits: integer('commits').notNull(),
		bugfixCommits: integer('bugfix_commits').notNull(),
		reverts: integer('reverts').notNull(),
		rationaleCommits: integer('rationale_commits').notNull(),
		authors: integer('authors').notNull(),
		firstAt: integer('first_at', { mode: 'timestamp_ms' }).notNull(),
		lastAt: integer('last_at', { mode: 'timestamp_ms' }).notNull(),
		topAuthors: text('top_authors', { mode: 'json' })
			.$type<{ email: string; name: string; commits: number }[]>()
			.notNull()
	},
	(table) => [primaryKey({ columns: [table.snapshotId, table.path] })]
);

/** Stage 2 `git blame -w` of every deep-scope source file (plan §4.4 `BlameRange`). */
export const blameRange = sqliteTable(
	'blame_range',
	{
		snapshotId: text('snapshot_id')
			.notNull()
			.references(() => snapshot.id, { onDelete: 'cascade' }),
		path: text('path').notNull(),
		/** 1-based, inclusive. */
		start: integer('start').notNull(),
		end: integer('end').notNull(),
		sha: text('sha').notNull(),
		origPath: text('orig_path').notNull(),
		origStart: integer('orig_start').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.snapshotId, table.path, table.start] }),
		index('blame_range_sha_idx').on(table.snapshotId, table.sha)
	]
);

/** Stage 2 author identity map (plan §4.4 `Author`). `githubLogin` is filled via the GitHub API. */
export const gitAuthor = sqliteTable(
	'git_author',
	{
		snapshotId: text('snapshot_id')
			.notNull()
			.references(() => snapshot.id, { onDelete: 'cascade' }),
		/** Lowercased. */
		email: text('email').notNull(),
		name: text('name').notNull(),
		commits: integer('commits').notNull(),
		firstAt: integer('first_at', { mode: 'timestamp_ms' }).notNull(),
		lastAt: integer('last_at', { mode: 'timestamp_ms' }).notNull(),
		githubLogin: text('github_login')
	},
	(table) => [primaryKey({ columns: [table.snapshotId, table.email] })]
);

/** `references`: a class/type named from elsewhere (reference index). */
export type EdgeKind =
	| 'calls'
	| 'includes'
	| 'uses_global'
	| 'uses_macro'
	| 'component_dep'
	| 'references'
	| 'co_changes';
export type EdgeMethod =
	'ast_direct' | 'name_match' | 'include_path' | 'reference_index' | 'git_cochange';
export type EdgeResolution = 'resolved' | 'ambiguous' | 'unresolved';

/**
 * Plan §4.4 / §4.5.1 `Edge`. Node ids: `file:<path>`, `sym:<path>#<name>`, `comp:<id>`.
 * `co_changes` is correlation only: impact traversal must never follow it.
 */
export const edge = sqliteTable(
	'edge',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		snapshotId: text('snapshot_id')
			.notNull()
			.references(() => snapshot.id, { onDelete: 'cascade' }),
		from: text('from').notNull(),
		to: text('to').notNull(),
		kind: text('kind').$type<EdgeKind>().notNull(),
		method: text('method').$type<EdgeMethod>().notNull(),
		resolution: text('resolution').$type<EdgeResolution>().notNull(),
		weight: real('weight').notNull().default(1),
		/** Ambiguous edges: the possible targets. */
		candidates: text('candidates', { mode: 'json' }).$type<string[]>(),
		/** Where the reference is (`{path, line}`), or for co-change `{count, strength, shas}`. */
		evidence: text('evidence', { mode: 'json' }).$type<Record<string, unknown>>()
	},
	(table) => [
		index('edge_from_idx').on(table.snapshotId, table.from),
		index('edge_to_idx').on(table.snapshotId, table.to)
	]
);
