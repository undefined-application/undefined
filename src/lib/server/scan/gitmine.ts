// Stage 2: git mining over the deep scope (plan §4.2, §4.3 "Git risk signals"). No LLM.
//
// The clone is blobless, and blame / rename detection need blob contents. Asking for them one
// at a time triggers a lazy fetch per object (minutes on ArduPilot), so the history's blobs are
// listed from tree diffs first and fetched in one batch.

import type { GitStats } from '$lib/scan';
import { ensureBlobs, git, type GitAuth } from './git';
import { ANALYSIS_CONFIG } from './snapshot';

const FS = '\x1f';
const RS = '\x1e';
const GS = '\x1d';
const LOG_FORMAT = '--format=%x1e%H%x1f%an%x1f%ae%x1f%at%x1f%B%x1d';
const ZERO_SHA = /^0+$/;
const GITLINK = '160000';

/** Languages worth blaming line by line: the ones stage 1/3 analyse. */
const BLAME_LANGUAGES = new Set(['c', 'c-header', 'cpp', 'cpp-header', 'asm']);

export interface RawChange {
	/** `M`, `A`, `D`, or `R<score>` / `C<score>` with rename detection. */
	status: string;
	oldBlob: string;
	newBlob: string;
	path: string;
	/** Set for renames and copies. */
	oldPath?: string;
}

export interface LogEntry {
	sha: string;
	authorName: string;
	authorEmail: string;
	authoredAt: number;
	message: string;
	changes: RawChange[];
}

/** Parse `git log --raw --no-abbrev` output made with `LOG_FORMAT`. */
export function parseLog(out: string): LogEntry[] {
	const entries: LogEntry[] = [];
	for (const record of out.split(RS)) {
		const end = record.indexOf(GS);
		if (end < 0) continue;
		const [sha, authorName, authorEmail, at, ...message] = record.slice(0, end).split(FS);
		const changes: RawChange[] = [];
		for (const line of record.slice(end + 1).split('\n')) {
			if (!line.startsWith(':')) continue;
			const tab = line.indexOf('\t');
			const [, , oldBlob, newBlob, status] = line.slice(1, tab).split(' ');
			const paths = line.slice(tab + 1).split('\t');
			changes.push(
				paths.length > 1
					? { status, oldBlob, newBlob, oldPath: paths[0], path: paths[1] }
					: { status, oldBlob, newBlob, path: paths[0] }
			);
		}
		entries.push({
			sha,
			authorName,
			authorEmail,
			authoredAt: Number(at) * 1000,
			message: message.join(FS).trim(),
			changes
		});
	}
	return entries;
}

const BUGFIX =
	/\b(fix(e[sd]|ing)?|bugs?|bugfix|hotfix|regression|crash(es|ed)?|broken|wrong|incorrect)\b/i;
/** Spike keyword list (docs/spike-results.md) plus the markers seen on the demo target. */
const RATIONALE =
	/\b(errat(a|um)|silicon|work[- ]?arounds?|quirks?|chip rev\w*|revision|glitch(es)?|spurious|races?|timing|timeouts?|delays?|reset|retry|retries|hangs?|datasheet|undocumented|anomal\w*|alignment|corrupt\w*|bad data|seen on)\b/i;
const REVERT_SUBJECT = /\brevert(s|ed|ing)?\b/i;
const REVERTS_COMMIT = /This reverts commit ([0-9a-f]{7,40})/i;
const ISSUE_REF = /(?:^|[\s(,])#(\d{1,6})\b/g;

export interface CommitClass {
	subject: string;
	body: string;
	bugfix: boolean;
	revert: boolean;
	/** Message states a hardware/timing reason (heuristic, not proof). */
	rationale: boolean;
	revertOf: string | null;
	/** `#123` issue/PR references. */
	refs: number[];
}

export function classifyMessage(message: string): CommitClass {
	const nl = message.indexOf('\n');
	const subject = (nl < 0 ? message : message.slice(0, nl)).trim();
	const body = nl < 0 ? '' : message.slice(nl + 1).trim();
	const revertOf = REVERTS_COMMIT.exec(message)?.[1] ?? null;
	const refs = [...new Set([...message.matchAll(ISSUE_REF)].map((m) => Number(m[1])))];
	return {
		subject,
		body,
		bugfix: BUGFIX.test(message),
		revert: revertOf !== null || REVERT_SUBJECT.test(subject),
		rationale: RATIONALE.test(message),
		revertOf,
		refs
	};
}

export interface MinedCommit extends CommitClass {
	sha: string;
	authorName: string;
	authorEmail: string;
	authoredAt: number;
	/** Deep-scope files touched, by their path at the snapshot commit (renames followed). */
	files: string[];
}

export interface FileHistory {
	path: string;
	commits: number;
	bugfixCommits: number;
	reverts: number;
	rationaleCommits: number;
	authors: number;
	firstAt: number;
	lastAt: number;
	topAuthors: { email: string; name: string; commits: number }[];
}

export interface AuthorStats {
	/** Lowercased; the identity key. */
	email: string;
	/** Most recent name used with this email. */
	name: string;
	commits: number;
	firstAt: number;
	lastAt: number;
}

/** Files that change together. Correlation only; impact traversal never follows it (plan §4.4). */
export interface CoChange {
	a: string;
	b: string;
	count: number;
	/** `count / min(commits(a), commits(b))`. */
	strength: number;
	/** Most recent shared commits. */
	shas: string[];
}

export interface BlameRange {
	path: string;
	/** 1-based, inclusive, in the snapshot's version of the file. */
	start: number;
	end: number;
	sha: string;
	/** Path and line in `sha`, which differ after renames or moves. */
	origPath: string;
	origStart: number;
}

/** Parse `git blame --incremental` output. */
export function parseBlameIncremental(out: string, path: string): BlameRange[] {
	const ranges: BlameRange[] = [];
	let cur: BlameRange | null = null;
	for (const line of out.split('\n')) {
		const m = /^([0-9a-f]{40}) (\d+) (\d+) (\d+)$/.exec(line);
		if (m) {
			const start = Number(m[3]);
			cur = {
				path,
				start,
				end: start + Number(m[4]) - 1,
				sha: m[1],
				origPath: path,
				origStart: Number(m[2])
			};
		} else if (cur && line.startsWith('filename ')) {
			cur.origPath = line.slice('filename '.length);
			ranges.push(cur);
			cur = null;
		}
	}
	return ranges.sort((a, b) => a.start - b.start);
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
	let next = 0;
	const worker = async () => {
		while (next < items.length) await fn(items[next++]);
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Fetch every historical blob of `paths` (up to `commitSha`) in one batch, so blame and
 * `log -L` on them run offline. Tree diffs only, no rename detection, so nothing is lazily fetched.
 */
export async function prefetchHistory(
	dir: string,
	commitSha: string,
	paths: string[],
	auth?: GitAuth
) {
	const out = await git(
		[
			'-c',
			'core.quotePath=false',
			'log',
			'--raw',
			'--no-renames',
			'--no-abbrev',
			'--format=',
			commitSha,
			'--',
			...paths
		],
		{ cwd: dir }
	);
	const blobs = new Set<string>();
	for (const line of out.split('\n')) {
		if (!line.startsWith(':')) continue;
		const [oldMode, newMode, oldBlob, newBlob] = line.slice(1, line.indexOf('\t')).split(' ');
		// Submodule entries (160000) name a commit in another repo; the remote refuses them.
		if (oldMode !== GITLINK && !ZERO_SHA.test(oldBlob)) blobs.add(oldBlob);
		if (newMode !== GITLINK && !ZERO_SHA.test(newBlob)) blobs.add(newBlob);
	}
	return ensureBlobs(dir, blobs, auth);
}

export interface MineInput {
	dir: string;
	commitSha: string;
	/** Repo-relative, `''` = whole repo. */
	deepScope: string;
	/** Deep-scope files at the snapshot commit (stage 0 inventory). */
	deepFiles: { path: string; language: string }[];
	auth?: GitAuth;
}

export interface MinedHistory {
	commits: MinedCommit[];
	files: FileHistory[];
	authors: AuthorStats[];
	coChanges: CoChange[];
	blame: BlameRange[];
	stats: GitStats;
}

export async function mineHistory(input: MineInput): Promise<MinedHistory> {
	const { dir, commitSha, deepScope, deepFiles, auth } = input;
	const t0 = Date.now();
	const pathspec = deepScope ? ['--', deepScope] : [];
	const log = (extra: string[]) =>
		git(
			[
				'-c',
				'core.quotePath=false',
				'log',
				'--no-merges',
				'--raw',
				'--no-abbrev',
				LOG_FORMAT,
				...extra,
				commitSha,
				...pathspec
			],
			{ cwd: dir }
		);

	// 1. One batched fetch for everything blame and rename detection will read.
	const fetched = await prefetchHistory(dir, commitSha, deepScope ? [deepScope] : [], auth);
	const tFetch = Date.now();

	// 2. The log with rename detection, newest first, mapping old names to snapshot paths.
	const entries = parseLog(await log(['-M']));
	const tLog = Date.now();
	const alias = new Map(deepFiles.map((f) => [f.path, f.path]));
	const commits: MinedCommit[] = entries.map((e) => {
		const files = new Set<string>();
		for (const c of e.changes) {
			const target = alias.get(c.path);
			if (!target) continue;
			files.add(target);
			if (c.oldPath && c.status.startsWith('R')) alias.set(c.oldPath, target);
		}
		return {
			sha: e.sha,
			authorName: e.authorName,
			authorEmail: e.authorEmail,
			authoredAt: e.authoredAt,
			files: [...files].sort(),
			...classifyMessage(e.message)
		};
	});

	// 3. Blame every source file in the deep scope at the snapshot.
	const blame: BlameRange[] = [];
	let blameFailures = 0;
	const sources = deepFiles.filter((f) => BLAME_LANGUAGES.has(f.language));
	await pool(sources, 4, async (f) => {
		const args = ['blame', '--incremental'];
		if (ANALYSIS_CONFIG.blameIgnoreWhitespace) args.push('-w');
		try {
			const out = await git([...args, commitSha, '--', f.path], { cwd: dir });
			blame.push(...parseBlameIncremental(out, f.path));
		} catch (err) {
			blameFailures++;
			console.warn(`[gitmine] blame failed for ${f.path}`, (err as Error).message);
		}
	});
	blame.sort((a, b) => a.path.localeCompare(b.path) || a.start - b.start);
	const tBlame = Date.now();

	// 4. Blame can land on commits outside the scope log (merges, pre-move paths). Load those too.
	const known = new Set(commits.map((c) => c.sha));
	const extra = [...new Set(blame.map((r) => r.sha))].filter((sha) => !known.has(sha));
	if (extra.length > 0) {
		const out = await git(['log', '--no-walk=unsorted', '--stdin', LOG_FORMAT], {
			cwd: dir,
			input: extra.join('\n') + '\n'
		});
		for (const e of parseLog(out)) {
			commits.push({
				sha: e.sha,
				authorName: e.authorName,
				authorEmail: e.authorEmail,
				authoredAt: e.authoredAt,
				files: [],
				...classifyMessage(e.message)
			});
		}
	}

	const files = fileHistories(commits);
	const authors = authorStats(commits);
	const coChanges = coChangePairs(commits, files);
	const scoped = commits.slice(0, entries.length);

	return {
		commits,
		files,
		authors,
		coChanges,
		blame,
		stats: {
			commits: scoped.length,
			bugfixCommits: scoped.filter((c) => c.bugfix).length,
			reverts: scoped.filter((c) => c.revert).length,
			rationaleCommits: scoped.filter((c) => c.rationale).length,
			authors: authors.length,
			blobsFetched: fetched,
			blamedFiles: sources.length - blameFailures,
			blameFailures,
			blameRanges: blame.length,
			coChangePairs: coChanges.length,
			ms: { fetch: tFetch - t0, log: tLog - tFetch, blame: tBlame - tLog, total: Date.now() - t0 }
		}
	};
}

export function fileHistories(commits: MinedCommit[]): FileHistory[] {
	const byPath = new Map<string, MinedCommit[]>();
	for (const c of commits) {
		for (const p of c.files) {
			const list = byPath.get(p);
			if (list) list.push(c);
			else byPath.set(p, [c]);
		}
	}
	return [...byPath].map(([path, list]) => {
		const byAuthor = new Map<string, { email: string; name: string; commits: number }>();
		for (const c of list) {
			const email = c.authorEmail.toLowerCase();
			const a = byAuthor.get(email) ?? { email, name: c.authorName, commits: 0 };
			a.commits++;
			byAuthor.set(email, a);
		}
		const times = list.map((c) => c.authoredAt);
		return {
			path,
			commits: list.length,
			bugfixCommits: list.filter((c) => c.bugfix).length,
			reverts: list.filter((c) => c.revert).length,
			rationaleCommits: list.filter((c) => c.rationale).length,
			authors: byAuthor.size,
			firstAt: Math.min(...times),
			lastAt: Math.max(...times),
			topAuthors: [...byAuthor.values()].sort((a, b) => b.commits - a.commits).slice(0, 3)
		};
	});
}

export function authorStats(commits: MinedCommit[]): AuthorStats[] {
	const byEmail = new Map<string, AuthorStats>();
	for (const c of commits) {
		const email = c.authorEmail.toLowerCase();
		const a = byEmail.get(email);
		if (!a) {
			byEmail.set(email, {
				email,
				name: c.authorName,
				commits: 1,
				firstAt: c.authoredAt,
				lastAt: c.authoredAt
			});
			continue;
		}
		a.commits++;
		if (c.authoredAt >= a.lastAt) a.name = c.authorName;
		a.firstAt = Math.min(a.firstAt, c.authoredAt);
		a.lastAt = Math.max(a.lastAt, c.authoredAt);
	}
	return [...byEmail.values()].sort((a, b) => b.commits - a.commits);
}

export function coChangePairs(commits: MinedCommit[], files: FileHistory[]): CoChange[] {
	const { coChangeMaxFiles, coChangeMinCount } = ANALYSIS_CONFIG;
	const fileCommits = new Map(files.map((f) => [f.path, f.commits]));
	const pairs = new Map<string, CoChange>();
	// Newest first, so `shas` keeps the most recent shared commits.
	const ordered = [...commits].sort((x, y) => y.authoredAt - x.authoredAt);
	for (const c of ordered) {
		// Sweeping commits (reformat, rename-all) touch everything and say nothing about coupling.
		if (c.files.length < 2 || c.files.length > coChangeMaxFiles) continue;
		for (let i = 0; i < c.files.length; i++) {
			for (let j = i + 1; j < c.files.length; j++) {
				const key = `${c.files[i]}\0${c.files[j]}`;
				const p = pairs.get(key) ?? {
					a: c.files[i],
					b: c.files[j],
					count: 0,
					strength: 0,
					shas: []
				};
				p.count++;
				if (p.shas.length < 5) p.shas.push(c.sha);
				pairs.set(key, p);
			}
		}
	}
	return [...pairs.values()]
		.filter((p) => p.count >= coChangeMinCount)
		.map((p) => ({
			...p,
			strength: p.count / Math.min(fileCommits.get(p.a) ?? p.count, fileCommits.get(p.b) ?? p.count)
		}))
		.sort((x, y) => y.count - x.count || y.strength - x.strength);
}

export interface LineHistoryEntry extends CommitClass {
	sha: string;
	authorName: string;
	authorEmail: string;
	authoredAt: number;
	/** Lines this commit added / removed inside the traced range (capped). */
	added: string[];
	removed: string[];
}

export interface LineHistory {
	/** Newest first: the commits that shaped these lines, back through moves and rewrites. */
	entries: LineHistoryEntry[];
	/** True when the trace stopped at `maxCommits` rather than at the lines' origin. */
	truncated: boolean;
	/**
	 * Oldest commit that added one of the traced lines with its current text (whitespace ignored).
	 * `null` = unknown: the text never appears as added in the traced history (moved/reformatted).
	 */
	introducedBy: string | null;
}

const norm = (line: string) => line.replace(/\s+/g, '');

/**
 * `git log -L start,end:path` from `commitSha`: every commit that touched these lines, newest
 * first, including the ones before the code was moved or reformatted (plan §3 rule 3).
 */
export async function lineHistory(
	dir: string,
	commitSha: string,
	path: string,
	start: number,
	end: number,
	maxCommits = 8
): Promise<LineHistory> {
	const [out, current] = await Promise.all([
		git(['log', `-L${start},${end}:${path}`, `-n${maxCommits}`, LOG_FORMAT, commitSha], {
			cwd: dir
		}),
		git(['show', `${commitSha}:${path}`], { cwd: dir })
	]);
	const entries: LineHistoryEntry[] = [];
	for (const record of out.split(RS)) {
		const cut = record.indexOf(GS);
		if (cut < 0) continue;
		const [sha, authorName, authorEmail, at, ...message] = record.slice(0, cut).split(FS);
		const added: string[] = [];
		const removed: string[] = [];
		for (const line of record.slice(cut + 1).split('\n')) {
			if (line.startsWith('+++') || line.startsWith('---')) continue;
			if (line.startsWith('+') && added.length < 40) added.push(line.slice(1));
			else if (line.startsWith('-') && removed.length < 40) removed.push(line.slice(1));
		}
		entries.push({
			sha,
			authorName,
			authorEmail,
			authoredAt: Number(at) * 1000,
			added,
			removed,
			...classifyMessage(message.join(FS).trim())
		});
	}
	const wanted = new Set(
		current
			.split('\n')
			.slice(start - 1, end)
			.map(norm)
			.filter((l) => l.length > 0)
	);
	let introducedBy: string | null = null;
	for (const e of entries) {
		if (e.added.some((l) => wanted.has(norm(l)))) introducedBy = e.sha;
	}
	return { entries, truncated: entries.length >= maxCommits, introducedBy };
}
