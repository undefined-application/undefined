// The wiki's "What not to break" (docs/ui-spec.md §4.3): code that looks removable but whose
// history or comments say it guards against something. Each fence comes with the commit that
// says why (the lines' full history, `git log -L`: blame stops at the last refactor), the verdict
// a PR changing it would get (the review's rule floor), what depends on it and whom to ask.
// Read side over a stored snapshot plus its clone; computed once per snapshot, no LLM.

import type { Person } from '$lib/claims';
import { bareSubject } from '$lib/format';
import type { CommitRef, Fence, FenceReport, Level } from '$lib/model';
import { VERDICT_RANK } from '$lib/review';
import {
	EXPLICIT_WORKAROUND,
	keyCommits,
	ruleFloor,
	strength,
	type HistoryHit
} from '$lib/server/review/rules';
import { blank } from './cparse';
import { git, type GitAuth } from './git';
import { lineHistory, prefetchHistory, type LineHistory, type LineHistoryEntry } from './gitmine';
import { blameAt, person, reachOf, type SnapshotView } from './views';

/** Candidates traced with `git log -L` (one git call each). */
const MAX_CANDIDATES = 20;
const MAX_FENCES = 8;
const MAX_PER_FILE = 3;
const HISTORY_DEPTH = 15;
/** Evidence further apart than this in one function is a separate guard. */
const GROUP_GAP = 8;
/** Longest guarded range, and context lines shown around it. */
const MAX_FOCUS = 14;
const CONTEXT_ABOVE = 3;
const CONTEXT_BELOW = 2;
/** A warning comment guards the next few lines of code under it. */
const CODE_AFTER_COMMENT = 3;
const CONCURRENCY = 4;

/** A comment that warns about hardware trouble. A bare datasheet reference cites a spec; it doesn't warn. */
const WARNING =
	/\b(errat(a|um)|silicon|work[- ]?arounds?|quirks?|hack|bug in|hardware bug|anomal\w*|glitch\w*|spurious|corrupt\w*|undocumented|not documented|alignment errors?)\b/i;

const LEVEL_BONUS: Record<Level, number> = { high: 2, medium: 1, low: 0 };

const BECAUSE: Record<string, string> = {
	reverted_before: 'a change to these lines was reverted before',
	explicit_workaround: 'the commit behind it states a hardware workaround',
	workaround_comment: 'a comment warns about it',
	bugfix_history: 'shaped by a bug-fix commit'
};
const CONTRACT_WORDS: Record<string, string> = {
	isr: 'an interrupt handler',
	timing: 'timing calls',
	timing_constant: 'a timing constant',
	watchdog: 'the watchdog',
	hw_access: 'volatile hardware access',
	hw_register: 'register access',
	concurrency: 'locking',
	external_interface: 'an external interface'
};

type Fn = SnapshotView['symbols'][number];

interface Evidence {
	start: number;
	end: number;
	weight: number;
	/** Set for warning comments: the matched comment line. */
	comment?: string;
}

interface Candidate {
	fn: Fn;
	/** Strongest evidence of the group. */
	anchor: Evidence;
	/** One guarded range: evidence lines close together in one function. */
	near: Evidence[];
	score: number;
}

const cache = new Map<string, Promise<FenceReport>>();

/** "What not to break" for a snapshot; computed once, kept in memory. */
export function fencesOf(m: SnapshotView, dir: string, auth?: GitAuth): Promise<FenceReport> {
	let report = cache.get(m.snapId);
	if (!report) {
		report = build(m, dir, auth);
		cache.set(m.snapId, report);
		report.catch(() => cache.delete(m.snapId));
	}
	return report;
}

export function forgetFences(snapId: string) {
	cache.delete(snapId);
}

async function build(m: SnapshotView, dir: string, auth?: GitAuth): Promise<FenceReport> {
	const t0 = Date.now();
	const candidates = collect(m);
	const picked = spread(candidates, MAX_CANDIDATES, MAX_PER_FILE + 2);
	const paths = [...new Set(picked.map((c) => c.fn.path))];
	if (paths.length) await prefetchHistory(dir, m.commit, paths, auth);

	const texts = new Map(
		await Promise.all(
			paths.map(async (p) => [p, await git(['show', `${m.commit}:${p}`], { cwd: dir })] as const)
		)
	);
	const built = await pool(picked, CONCURRENCY, (c) => fence(m, dir, c, texts.get(c.fn.path)!));
	const ranked = built
		.filter((f): f is { fence: Fence; rank: number } => f !== null)
		.sort((a, b) => b.rank - a.rank)
		.map((f) => f.fence);

	// The same guard copied into several places (same reverted change, same workaround commit,
	// same comment or title): one card, listing the other places. Only a commit whose subject
	// names the workaround counts; a broad commit that only mentions it in passing touched many.
	// A card keeps its copies' keys too, so a third copy that matches only the second still joins.
	const keysOf = (f: Fence) =>
		[
			f.reverted && `revert:${f.reverted.change.sha}`,
			f.origin?.stated === 'subject' && `origin:${f.origin.sha}`,
			f.comment && `text:${norm(f.comment.text)}`,
			`text:${norm(f.title)}`
		].filter((k): k is string => !!k);
	const fences: { fence: Fence; keys: Set<string> }[] = [];
	const perFile = new Map<string, number>();
	for (const f of ranked) {
		const keys = keysOf(f);
		const twin = fences.find((g) => keys.some((k) => g.keys.has(k)));
		if (twin) {
			twin.fence.alsoIn.push({ fn: f.fn.name, path: f.path, line: f.start });
			for (const k of keys) twin.keys.add(k);
			continue;
		}
		if ((perFile.get(f.path) ?? 0) >= MAX_PER_FILE || fences.length >= MAX_FENCES) continue;
		perFile.set(f.path, (perFile.get(f.path) ?? 0) + 1);
		fences.push({ fence: f, keys: new Set(keys) });
	}
	return {
		fences: fences.map((f) => f.fence),
		candidates: candidates.length,
		ms: Date.now() - t0
	};
}

/** Functions with workaround evidence: revert lines, explicit-workaround commits, warning comments. */
function collect(m: SnapshotView): Candidate[] {
	const fnsByPath = new Map<string, Fn[]>();
	for (const s of m.symbols) {
		if (s.kind !== 'function') continue;
		const list = fnsByPath.get(s.path) ?? [];
		list.push(s);
		fnsByPath.set(s.path, list);
	}
	const innermost = (path: string, line: number) =>
		(fnsByPath.get(path) ?? [])
			.filter((f) => f.start <= line && line <= f.end)
			.sort((a, b) => a.end - a.start - (b.end - b.start))[0];

	const byFn = new Map<string, { fn: Fn; evidence: Evidence[] }>();
	for (const s of m.signals) {
		let weight = 0;
		if (s.kind === 'git_revert') weight = 5;
		else if (s.kind === 'git_workaround')
			weight = EXPLICIT_WORKAROUND.test(m.commits.get(s.detail)?.subject ?? '') ? 3 : 0;
		// A label like `// corrupt data` names a case; a sentence that warns explains one.
		else if (s.kind === 'workaround_comment')
			weight = WARNING.test(s.snippet) && s.snippet.split(/\s+/).length >= 4 ? 3 : 1;
		if (!weight) continue;
		const fn = innermost(s.path, s.start);
		if (!fn) continue;
		const entry = byFn.get(fn.id) ?? { fn, evidence: [] };
		entry.evidence.push({
			start: s.start,
			end: s.end,
			weight,
			comment: s.kind === 'workaround_comment' ? s.snippet : undefined
		});
		byFn.set(fn.id, entry);
	}

	// A long function can hold several guards: evidence more than GROUP_GAP lines apart is another.
	const candidates: Candidate[] = [];
	for (const { fn, evidence } of byFn.values()) {
		evidence.sort((a, b) => a.start - b.start);
		let group: Evidence[] = [];
		const flush = () => {
			if (!group.length) return;
			const anchor = group.reduce((a, b) => (b.weight > a.weight ? b : a));
			const score =
				anchor.weight + Math.min(group.length - 1, 4) * 0.5 + LEVEL_BONUS[fn.level as Level];
			candidates.push({ fn, anchor, near: group, score });
			group = [];
		};
		for (const e of evidence) {
			if (group.length && e.start - group[group.length - 1].end > GROUP_GAP) flush();
			group.push(e);
		}
		flush();
	}
	return candidates.sort((a, b) => b.score - a.score || b.fn.criticality - a.fn.criticality);
}

/** Top `n` items, at most `perFile` from one file. */
function spread(items: Candidate[], n: number, perFile: number): Candidate[] {
	const out: Candidate[] = [];
	const count = new Map<string, number>();
	for (const c of items) {
		if (out.length >= n) break;
		if ((count.get(c.fn.path) ?? 0) >= perFile) continue;
		count.set(c.fn.path, (count.get(c.fn.path) ?? 0) + 1);
		out.push(c);
	}
	return out;
}

async function fence(
	m: SnapshotView,
	dir: string,
	c: Candidate,
	text: string
): Promise<{ fence: Fence; rank: number } | null> {
	const { fn } = c;
	const src = text.split('\n');
	const code = blank(text).code.split('\n');
	const hasCode = (line: number) => (code[line - 1] ?? '').trim() !== '';
	const isComment = (line: number) => {
		const s = (src[line - 1] ?? '').trim();
		return !hasCode(line) && s !== '' && !s.startsWith('#');
	};

	// The guarded range: the evidence lines, each warning comment in full, and the code under it.
	let start = Math.min(...c.near.map((e) => e.start));
	let end = Math.max(...c.near.map((e) => e.end));
	let comment: Fence['comment'] = null;
	let commentWeight = 0;
	for (const e of c.near.filter((x) => x.comment)) {
		let a = e.start;
		let b = e.start;
		let seen = 0;
		if (hasCode(e.start)) seen = 1;
		else {
			while (a - 1 >= fn.start && isComment(a - 1)) a--;
			while (b + 1 <= fn.end && isComment(b + 1)) b++;
		}
		let k = b;
		while (k + 1 <= fn.end && seen < CODE_AFTER_COMMENT) if (hasCode(++k)) seen++;
		start = Math.min(start, a);
		end = Math.max(end, k);
		if (e.weight > commentWeight) {
			comment = { line: a, text: commentText(src.slice(a - 1, b)) };
			commentWeight = e.weight;
		}
	}
	start = Math.max(start, fn.start);
	end = Math.min(end, fn.end, start + MAX_FOCUS - 1);

	let history: LineHistory;
	try {
		history = await lineHistory(dir, m.commit, fn.path, start, end, HISTORY_DEPTH);
	} catch {
		history = { entries: [], truncated: false, introducedBy: null };
	}
	const { entries } = history;

	// Why it exists: the oldest commit that states a workaround (subject over body), else the oldest fix.
	const stated = keyCommits(entries).strong.find((e) => !e.revert);
	const fixed = entries.filter((e) => !e.revert && (e.bugfix || e.rationale)).at(-1);
	const originEntry = stated ?? fixed;
	let origin: Fence['origin'] = null;
	if (originEntry) {
		const inSubject = EXPLICIT_WORKAROUND.test(originEntry.subject);
		const sentence = stated && !inSubject ? bodySentence(originEntry.body) : null;
		origin = {
			...ref(originEntry),
			stated: stated ? (inSubject ? 'subject' : 'body') : null,
			said: sentence ?? originEntry.subject
		};
	}

	// Changed before and reverted: a revert in the lines' history, and the change it undid.
	let reverted: Fence['reverted'] = null;
	const rev = entries.find((e) => e.revert && e.revertOf);
	if (rev) {
		const undone = entries.find((e) => e.sha.startsWith(rev.revertOf!));
		const known = m.commits.get(rev.revertOf!);
		const change: CommitRef | null = undone
			? ref(undone)
			: known
				? {
						sha: known.sha,
						subject: known.subject,
						author: known.authorName,
						date: known.authoredAt.toISOString()
					}
				: null;
		if (change) {
			const reason =
				rev.body
					.split('\n')
					.map((l) => l.trim())
					.find((l) => l && !/^this reverts commit/i.test(l)) ?? null;
			reverted = {
				change,
				revert: ref(rev),
				days: Math.round((rev.authoredAt - Date.parse(change.date)) / 86_400_000),
				reason: reason && clip(reason, 200)
			};
		}
	}

	// The verdict a PR changing these lines would get: the review's rule floor on the same evidence.
	const reach = reachOf(m, fn.id);
	const key = keyCommits(entries).key;
	const where = `${fn.path}:${start}${end > start ? `-${end}` : ''}`;
	const hits: HistoryHit[] = key
		? [
				{
					where,
					sha: key.sha,
					subject: key.subject,
					revert: key.revert,
					bugfix: key.bugfix,
					rationale: key.rationale,
					explicit: strength(key) > 0 && !key.revert
				}
			]
		: [];
	const onLines = (s: { path: string; start: number }, from: number) =>
		s.path === fn.path && s.start >= Math.max(from, fn.start) && s.start <= end;
	const { floor, reasons } = ruleFloor({
		behaviourFree: false,
		history: hits,
		workaroundComments: m.signals
			.filter((s) => s.kind === 'workaround_comment' && onLines(s, start - 5))
			.map((s) => ({ where: `${fn.path}:${s.start}`, comment: s.snippet })),
		signals: m.signals
			.filter((s) => s.source === 'static' && onLines(s, start))
			.map((s) => ({ where: `${fn.path}:${s.start}`, kind: s.kind })),
		touched: [{ name: fn.name, level: fn.level as Level }],
		completeness: reach.lowerBound ? 'partial' : 'complete',
		// Tests aren't in the stored model. Only rules at the floor are shown, and a fence's
		// floor is DANGEROUS or STOP, which the RISKY test rule can't change.
		relatedTests: 0
	});
	if (VERDICT_RANK[floor] < VERDICT_RANK.DANGEROUS) return null;
	const because = [
		...new Set(
			reasons
				.filter((r) => r.verdict === floor)
				.map((r) =>
					r.rule === 'contract_signal'
						? `touches ${CONTRACT_WORDS[r.detail.split(' ')[0]] ?? 'hardware-facing code'}`
						: (BECAUSE[r.rule] ?? r.rule.replaceAll('_', ' '))
				)
		)
	];

	const askEntry = originEntry ?? rev ?? entries.find((e) => e.sha === history.introducedBy);
	const blamed = blameAt(m, fn.path, c.anchor.start);
	const ask =
		(askEntry ? (person(m, askEntry.sha) ?? personOf(m, askEntry)) : null) ??
		(blamed ? person(m, blamed.sha) : null);

	// Title: a commit subject that names the workaround, else the comment's warning sentence.
	const title =
		origin?.stated === 'subject'
			? sentenceCase(bareSubject(origin.subject))
			: comment
				? headline(comment.text)
				: origin
					? sentenceCase(bareSubject(origin.subject))
					: reverted
						? `Reverted before: ${bareSubject(reverted.change.subject)}`
						: `${fn.shortName}: code with a workaround history`;

	const from = Math.max(fn.start, start - CONTEXT_ABOVE);
	const to = Math.min(fn.end, end + CONTEXT_BELOW);
	return {
		rank:
			VERDICT_RANK[floor] * 10 +
			(reverted ? 4 : 0) +
			(origin?.stated === 'subject' ? 4 : origin ? 1 : 0) +
			c.score,
		fence: {
			id: `${fn.path}:${start}`,
			title,
			fn: { id: fn.id, name: fn.name, level: fn.level as Level },
			path: fn.path,
			start,
			end,
			code: { start: from, lines: src.slice(from - 1, to).map((l) => l.trimEnd()) },
			verdict: floor,
			because,
			origin,
			reverted,
			comment,
			alsoIn: [],
			dependents: {
				functions: reach.symbols.affected,
				files: reach.files.affected,
				outside: reach.outside,
				lowerBound: reach.lowerBound
			},
			ask
		}
	};
}

const ref = (e: LineHistoryEntry): CommitRef => ({
	sha: e.sha,
	subject: e.subject,
	author: e.authorName,
	date: new Date(e.authoredAt).toISOString()
});

function personOf(m: SnapshotView, e: LineHistoryEntry): Person {
	return {
		name: e.authorName,
		email: e.authorEmail,
		sha: e.sha,
		date: new Date(e.authoredAt).toISOString(),
		subject: e.subject,
		login: m.authors.get(e.authorEmail.toLowerCase())?.githubLogin ?? null
	};
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const norm = (s: string) => s.toLowerCase().replace(/\W+/g, ' ').trim();
const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Comment lines as prose: markers stripped, whitespace collapsed. */
function commentText(lines: string[]): string {
	const text = lines
		.map((l) =>
			l
				.replace(/^.*?(\/\/+|\/\*+)/, '')
				.replace(/\*+\/.*$/, '')
				.replace(/^\s*\*+(?!\/)/, '')
				.trim()
		)
		.filter(Boolean)
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
	return clip(text, 400);
}

const sentences = (text: string) =>
	text
		.replace(/\s+/g, ' ')
		.trim()
		.split(/(?<=[.!?])\s+/);

/** The comment's warning sentence, as a card title. */
function headline(text: string): string {
	const all = sentences(text);
	const warning = all.find((s) => WARNING.test(s)) ?? all[0];
	return sentenceCase(clipWords(warning.replace(/[.:;,!]+$/, ''), 110));
}

/** The sentence of a commit body that states the workaround. */
function bodySentence(body: string): string | null {
	const hit = sentences(body).find((s) => EXPLICIT_WORKAROUND.test(s));
	return hit ? clipWords(hit, 200) : null;
}

/** Clip at a word boundary. */
const clipWords = (s: string, n: number) =>
	s.length <= n ? s : `${s.slice(0, s.lastIndexOf(' ', n - 1)).replace(/[,;:]$/, '')}…`;

async function pool<T, R>(items: T[], n: number, run: (item: T) => Promise<R>): Promise<R[]> {
	const out = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await run(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
	return out;
}
