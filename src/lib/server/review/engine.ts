// Tab 4 review engine (plan §5 Tab 4). Deterministic first: diff → merge-base analysis → line
// history → signals → impact → completeness → rule floor → cited findings. The LLM (optional)
// only writes the rationale and extra claims, validated, and may raise the verdict, never lower it.

import type { Citation, Claim, Person } from '$lib/claims';
import type { PullSummary } from '$lib/github';
import type {
	ChangeClass,
	CompletenessLevel,
	Finding,
	ReviewResult,
	TouchedSymbol,
	Verdict
} from '$lib/review';
import { computeImpact } from '$lib/server/evidence/impact';
import type { EvidenceItem } from '$lib/server/evidence/validate';
import { inScope, languageOf, listTree, mergeBase } from '$lib/server/scan/acquire';
import { parseC } from '$lib/server/scan/cparse';
import { ensureBlobs, git, readBlobs, type GitAuth } from '$lib/server/scan/git';
import { lineHistory, prefetchHistory, type LineHistory } from '$lib/server/scan/gitmine';
import { analyzeSnapshot } from '$lib/server/scan/pipeline';
import { detectSignals } from '$lib/server/scan/signals';
import { SOURCE_LANGUAGES, type SymbolRow } from '$lib/server/scan/structure';
import {
	classifyChange,
	parseDisplayDiff,
	parseUnifiedDiff,
	type FileDiff,
	type Hunk
} from './diff';
import { CONTRACT_SIGNALS, keyCommits, ruleFloor, strength, type HistoryHit } from './rules';

const MAX_HISTORY_HUNKS = 25;
const IMPACT_DEPTH = 3;
const MAX_IMPACT_NODES = 150;
const GENERIC = new Set([
	'init',
	'update',
	'start',
	'read',
	'write',
	'reset',
	'begin',
	'end',
	'run',
	'loop',
	'setup'
]);

const isSource = (p: string) => SOURCE_LANGUAGES.has(languageOf(p));
const isCommentOrBlank = (l: string) => {
	const t = l.trim();
	return !t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/');
};
const clip = (s: string, n = 300) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const iso = (ms: number) => new Date(ms).toISOString();

function commonDir(paths: string[]): string {
	const dirs = paths.map((p) => p.split('/').slice(0, -1));
	if (dirs.length === 0) return '';
	const out: string[] = [];
	for (let i = 0; ; i++) {
		const seg = dirs[0][i];
		if (seg === undefined || !dirs.every((d) => d[i] === seg)) break;
		out.push(seg);
	}
	return out.join('/');
}

function innermost(fns: SymbolRow[], line: number): SymbolRow | undefined {
	return fns
		.filter((f) => f.start <= line && line <= f.end)
		.sort((a, b) => a.end - a.start - (b.end - b.start))[0];
}

export interface AnalyzePullInput {
	dir: string;
	repo: string;
	pull: PullSummary;
	/** Deep scope of the user's latest scan of this repo, if it covers the change. */
	scanScope: { deepScope: string; scanId: string } | null;
	auth?: GitAuth;
	onStage?: (stage: string) => void;
	/** Resolve a commit author's GitHub login (Ask-the-author). */
	lookupLogin?: (sha: string) => Promise<string | null>;
}

export interface PullAnalysis {
	result: ReviewResult;
	/** Evidence packet for the LLM step: everything the findings cite, with ids. */
	evidence: EvidenceItem[];
}

export async function analyzePull(input: AnalyzePullInput): Promise<PullAnalysis> {
	const { dir, pull, auth, onStage } = input;
	const t0 = Date.now();

	// 1. Pin snapshots.
	onStage?.('Pinning merge base');
	const mb = await mergeBase(dir, pull.baseSha, pull.headSha);

	// 2. Diff, with every blob it needs fetched in one batch.
	onStage?.('Reading the diff');
	const raw = await git(
		[
			'-c',
			'core.quotePath=false',
			'diff',
			'--raw',
			'--no-renames',
			'--no-abbrev',
			mb,
			pull.headSha
		],
		{ cwd: dir }
	);
	const blobOf = new Map<string, { old: string | null; new: string | null }>();
	for (const line of raw.split('\n')) {
		if (!line.startsWith(':')) continue;
		const [, , oldBlob, newBlob] = line.slice(1, line.indexOf('\t')).split(' ');
		const path = line.slice(line.indexOf('\t') + 1);
		blobOf.set(path, {
			old: /^0+$/.test(oldBlob) ? null : oldBlob,
			new: /^0+$/.test(newBlob) ? null : newBlob
		});
	}
	const blobShas = [...blobOf.values()]
		.flatMap((b) => [b.old, b.new])
		.filter((s): s is string => !!s);
	await ensureBlobs(dir, blobShas, auth);
	const texts = await readBlobs(dir, blobShas);
	const oldText = (p: string | null) => (p ? (texts.get(blobOf.get(p)?.old ?? '') ?? null) : null);
	const newText = (p: string | null) => (p ? (texts.get(blobOf.get(p)?.new ?? '') ?? null) : null);
	const diffs: FileDiff[] = parseUnifiedDiff(
		await git(
			[
				'-c',
				'core.quotePath=false',
				'diff',
				'--no-ext-diff',
				'--no-color',
				'-U0',
				'--no-renames',
				mb,
				pull.headSha
			],
			{ cwd: dir }
		)
	);
	const pathOf = (d: FileDiff) => (d.newPath ?? d.oldPath)!;
	// The same diff with context, for the Files changed view (docs/ui-spec.md §4.7).
	const display = parseDisplayDiff(
		await git(
			[
				'-c',
				'core.quotePath=false',
				'diff',
				'--no-ext-diff',
				'--no-color',
				'-U3',
				'--no-renames',
				mb,
				pull.headSha
			],
			{ cwd: dir }
		)
	);

	// 3. Change class per file.
	const classes = diffs.map((d) => ({
		path: pathOf(d),
		class: (d.binary
			? 'code'
			: classifyChange(pathOf(d), oldText(d.oldPath), newText(d.newPath))) as ChangeClass
	}));
	const behaviourFree = classes.length > 0 && classes.every((c) => c.class !== 'code');

	// 4. Analyse the merge-base snapshot over the deep scope (the scan's, or the changed code's directory).
	const changedSources = diffs.map(pathOf).filter(isSource);
	const scanCovers =
		input.scanScope && changedSources.some((p) => inScope(p, input.scanScope!.deepScope));
	const deepScope = scanCovers
		? input.scanScope!.deepScope
		: commonDir(changedSources.length ? changedSources : diffs.map(pathOf));
	onStage?.(`Analysing ${deepScope || 'the repo'} at the merge base`);
	const tree = await listTree(dir, mb);
	const model = await analyzeSnapshot({
		dir,
		commitSha: mb,
		deepScope,
		referenceScope: '',
		tree,
		auth,
		withHistory: false
	});

	const fnsByPath = new Map<string, SymbolRow[]>();
	for (const s of model.structure.symbols) {
		if (s.kind !== 'function') continue;
		const list = fnsByPath.get(s.path) ?? [];
		list.push(s);
		fnsByPath.set(s.path, list);
	}

	// 5. Touched symbols: base side (changed/removed/insertion point) and head side (new functions).
	const touched = new Map<string, TouchedSymbol>();
	const touch = (
		s: SymbolRow,
		side: 'base' | 'head',
		score = 0,
		level: TouchedSymbol['level'] = 'low'
	) => {
		if (!touched.has(s.id))
			touched.set(s.id, {
				id: s.id,
				name: s.name,
				path: s.path,
				start: s.start,
				end: s.end,
				level,
				score,
				side
			});
	};
	let outsideFunctions = 0;
	const codeHunks: { path: string; hunk: Hunk; start: number; end: number }[] = [];
	for (const d of diffs) {
		if (d.binary || !d.oldPath || !isSource(d.oldPath)) continue;
		const fns = fnsByPath.get(d.oldPath) ?? [];
		for (const h of d.hunks) {
			const start = h.oldLines > 0 ? h.oldStart : Math.max(1, h.oldStart);
			const end = h.oldLines > 0 ? h.oldStart + h.oldLines - 1 : start;
			let any = false;
			for (let line = start; line <= end; line++) {
				const f = innermost(fns, line);
				if (f) {
					any = true;
					const c = model.symbolScores.get(f.id);
					touch(f, 'base', c?.score ?? 0, c?.level ?? 'low');
				}
			}
			const codeChange = !h.removed.every(isCommentOrBlank) || !h.added.every(isCommentOrBlank);
			if (!any && codeChange) outsideFunctions++;
			if (h.oldLines > 0 && codeChange) codeHunks.push({ path: d.oldPath, hunk: h, start, end });
		}
	}
	const headParsed = new Map<string, ReturnType<typeof parseC>>();
	for (const d of diffs) {
		if (d.binary || !d.newPath || !isSource(d.newPath)) continue;
		const text = newText(d.newPath);
		if (text === null) continue;
		const p = parseC(text);
		headParsed.set(d.newPath, p);
		const existing = new Set((fnsByPath.get(d.oldPath ?? '') ?? []).map((f) => f.name));
		for (const h of d.hunks) {
			for (let line = h.newStart; line < h.newStart + h.newLines; line++) {
				const f = p.symbols
					.filter((s) => s.kind === 'function' && s.start <= line && line <= s.end)
					.pop();
				if (f && !existing.has(f.name)) {
					touch(
						{ ...f, id: `sym:${d.newPath}#${f.name}@head`, path: d.newPath, externalCalls: 0 },
						'head'
					);
				}
			}
		}
	}

	// 6. Line history of changed code (merge base), newest first.
	onStage?.('Tracing line history');
	const histories: { path: string; start: number; end: number; history: LineHistory }[] = [];
	let historyFailures = 0;
	const historyPaths = [...new Set(codeHunks.map((h) => h.path))];
	if (!behaviourFree && historyPaths.length) {
		await prefetchHistory(dir, mb, historyPaths, auth);
		for (const h of codeHunks.slice(0, MAX_HISTORY_HUNKS)) {
			try {
				histories.push({
					path: h.path,
					start: h.start,
					end: h.end,
					history: await lineHistory(dir, mb, h.path, h.start, h.end)
				});
			} catch {
				historyFailures++;
			}
		}
	}
	// One key commit per hunk: the strongest evidence, and among equals the oldest (the origin).
	const keyed = histories.map((h) => ({ ...h, ...keyCommits(h.history.entries) }));
	const historyHits: HistoryHit[] = keyed.flatMap(({ path, start, end, key }) =>
		key
			? [
					{
						where: `${path}:${start}${end > start ? `-${end}` : ''}`,
						sha: key.sha,
						subject: key.subject,
						revert: key.revert,
						bugfix: key.bugfix,
						rationale: key.rationale,
						explicit: strength(key) > 0 && !key.revert
					}
				]
			: []
	);

	// 7. Signals on changed lines (base), added lines (head), and workaround comments guarding changed code.
	const signalsHit: {
		where: string;
		kind: string;
		path: string;
		line: number;
		snippet: string;
		commit: string;
	}[] = [];
	const workaroundComments: { where: string; comment: string; path: string; line: number }[] = [];
	for (const h of codeHunks) {
		for (const s of model.signals) {
			if (s.path !== h.path || s.source === 'git') continue;
			if (s.start >= h.start && s.start <= h.end && s.source === 'static') {
				signalsHit.push({
					where: `${s.path}:${s.start}`,
					kind: s.kind,
					path: s.path,
					line: s.start,
					snippet: s.snippet,
					commit: mb
				});
			}
			if (s.kind === 'workaround_comment' && s.start >= h.start - 5 && s.start <= h.end) {
				const fn = innermost(fnsByPath.get(h.path) ?? [], h.start);
				if (!fn || (s.start >= fn.start && s.start <= fn.end)) {
					workaroundComments.push({
						where: `${s.path}:${h.start}`,
						comment: s.snippet,
						path: s.path,
						line: s.start
					});
				}
			}
		}
	}
	for (const d of diffs) {
		const p = d.newPath ? headParsed.get(d.newPath) : undefined;
		if (!p || !d.newPath) continue;
		const added = new Set(
			d.hunks.flatMap((h) => Array.from({ length: h.newLines }, (_, i) => h.newStart + i))
		);
		for (const s of detectSignals(d.newPath, newText(d.newPath)!, p)) {
			if (added.has(s.start) && s.source === 'static') {
				signalsHit.push({
					where: `${d.newPath}:${s.start} (new)`,
					kind: s.kind,
					path: d.newPath,
					line: s.start,
					snippet: s.snippet,
					commit: pull.headSha
				});
			}
		}
	}

	// 8. Impact: transitive dependents of the touched code over non-correlation edges.
	onStage?.('Exploring dependents');
	const impact = computeImpact(
		{
			edges: model.structure.edges,
			symbols: model.structure.symbols,
			deepPaths: new Set(model.structure.parsed.keys())
		},
		[...touched.values()].filter((t) => t.side === 'base').map((t) => t.id),
		{ changedPaths: diffs.map(pathOf), depth: IMPACT_DEPTH, maxNodes: MAX_IMPACT_NODES }
	);

	// 9. Related tests (static reference, never "coverage").
	const touchedNames = [...touched.values()]
		.map((t) => t.name.slice(t.name.lastIndexOf(':') + 1))
		.filter((n) => n.length >= 5 && !GENERIC.has(n));
	const changedBases = diffs
		.map((d) => pathOf(d).split('/').pop()!)
		.filter((b) => /\.(h|hpp)$/.test(b));
	const related: { path: string; symbols: string[] }[] = [];
	for (const [path, text] of model.testSources) {
		const symbols = touchedNames.filter((n) => new RegExp(`\\b${n}\\b`).test(text));
		const includes = changedBases.filter((b) => text.includes(b));
		if (symbols.length || includes.length)
			related.push({ path, symbols: [...symbols, ...includes] });
	}
	const criticalTouched = [...touched.values()].filter(
		(t) =>
			t.level !== 'low' ||
			signalsHit.some((s) => s.path === t.path && s.line >= t.start && s.line <= t.end)
	);
	const missing = criticalTouched
		.filter(
			(t) => !related.some((r) => r.symbols.includes(t.name.slice(t.name.lastIndexOf(':') + 1)))
		)
		.map((t) => t.name);

	// 10. Completeness.
	const reasons: { level: CompletenessLevel; text: string }[] = [];
	const touchedFiles = new Set(diffs.map(pathOf));
	const badParse = model.structure.files.filter(
		(f) => touchedFiles.has(f.path) && (!f.parsed || f.unbalanced)
	);
	if (badParse.length)
		reasons.push({
			level: 'insufficient',
			text: `${badParse.length} changed file(s) failed to parse cleanly`
		});
	if (historyFailures)
		reasons.push({
			level: 'insufficient',
			text: `line history unavailable for ${historyFailures} hunk(s)`
		});
	const unanalysed = classes.filter((c) => c.class === 'code' && !isSource(c.path));
	if (unanalysed.length)
		reasons.push({
			level: 'partial',
			text: `${unanalysed.length} changed non-C/C++ file(s) not analysed (${unanalysed
				.map((c) => c.path.split('/').pop())
				.slice(0, 3)
				.join(', ')})`
		});
	if (outsideFunctions)
		reasons.push({
			level: 'partial',
			text: `${outsideFunctions} change(s) outside any function (declarations, globals, macros): dependents found by name only`
		});
	if (impact.counts.ambiguous)
		reasons.push({
			level: 'partial',
			text: `${impact.counts.ambiguous} ambiguous dependency edge(s) reached (overloads / same-named methods)`
		});
	if (impact.counts.unresolved)
		reasons.push({
			level: 'partial',
			text: `${impact.counts.unresolved} unresolved call(s) (function pointers / callbacks) in the touched code`
		});
	if (impact.counts.boundary)
		reasons.push({
			level: 'partial',
			text: `${impact.counts.boundary} reference(s) from outside ${deepScope || 'the scope'}, matched by name`
		});
	const variants = [...touchedFiles].filter((p) =>
		model.structure.parsed.get(p)?.blanked.directives.some((d) => /^#\s*(else|elif)\b/.test(d.text))
	);
	if (variants.length)
		reasons.push({
			level: 'partial',
			text: `#else/#elif platform variants in ${variants.length} changed file(s) not analysed`
		});
	if (touched.size > 0 && !scanCovers)
		reasons.push({
			level: 'partial',
			text: 'no scan of this repo covers the change: git risk signals limited to the changed lines'
		});
	const completeness: CompletenessLevel = reasons.some((r) => r.level === 'insufficient')
		? 'insufficient'
		: reasons.length
			? 'partial'
			: 'complete';

	// 11. Rule floor.
	const { floor, reasons: floorReasons } = ruleFloor({
		behaviourFree,
		history: historyHits,
		workaroundComments,
		signals: signalsHit,
		touched: [...touched.values()].filter((t) => t.side === 'base'),
		completeness,
		relatedTests: related.length
	});

	// 12. Findings, every one built from cited evidence.
	onStage?.('Writing findings');
	const evidence: EvidenceItem[] = [];
	const cite = (citation: Citation, text: string): Citation => {
		evidence.push({ id: `E${evidence.length + 1}`, citation, text });
		return citation;
	};
	const logins = new Map<string, string | null>();
	const person = async (e: {
		sha: string;
		authorName: string;
		authorEmail: string;
		authoredAt: number;
		subject: string;
	}): Promise<Person> => {
		if (!logins.has(e.sha))
			logins.set(
				e.sha,
				input.lookupLogin ? await input.lookupLogin(e.sha).catch(() => null) : null
			);
		return {
			name: e.authorName,
			email: e.authorEmail,
			sha: e.sha,
			date: iso(e.authoredAt),
			subject: e.subject,
			login: logins.get(e.sha)
		};
	};
	const baseLines = (path: string, start: number, end: number) =>
		(model.sources.get(path) ?? '')
			.split('\n')
			.slice(start - 1, end)
			.join('\n');

	const findings: Finding[] = [];
	const openQuestions: Claim[] = [];
	for (const { path, start, end, history, strong, weak, key } of keyed) {
		if (!key) continue;
		const code = cite({ kind: 'code', commit: mb, path, start, end }, baseLines(path, start, end));
		const claims: Claim[] = [
			{
				text: `The PR changes ${path.split('/').pop()}:${start}${end > start ? `–${end}` : ''}.`,
				status: 'verified',
				basis: 'code_fact',
				citations: [code]
			}
		];
		for (const e of [...strong, ...weak].slice(0, 4)) {
			const msg = e.body ? `${e.subject} — ${clip(e.body.replace(/\s+/g, ' '), 260)}` : e.subject;
			const c = cite(
				{ kind: 'commit', sha: e.sha, subject: e.subject },
				`${e.subject}\n${e.body}\n${e.added.join('\n')}`
			);
			claims.push({
				text: e.revert
					? `These lines were restored by a revert, ${e.sha.slice(0, 10)}: "${msg}".`
					: `Commit ${e.sha.slice(0, 10)} (${e.authorName}, ${iso(e.authoredAt).slice(0, 10)}) shaped these lines; its message says: "${msg}".`,
				status: 'verified',
				basis: 'commit_statement',
				citations: [c]
			});
		}
		const ask = await person(key);
		findings.push({
			severity: strong.length ? 'STOP' : 'DANGEROUS',
			title: strong.length
				? `Alters code with an explicit workaround history (${key.subject})`
				: `Alters code with bug-fix history (${key.subject})`,
			claims,
			ask
		});
		if (strong.length) {
			openQuestions.push({
				text: `Does the problem that ${key.sha.slice(0, 10)} ("${key.subject}") works around still occur on the hardware this code supports? Neither the code nor the history says.`,
				status: 'unknown',
				basis: 'inference',
				citations: [],
				ask
			});
		}
		if (history.truncated) {
			openQuestions.push({
				text: `History of ${path.split('/').pop()}:${start} goes further back than traced (${history.entries.length} commits).`,
				status: 'unknown',
				basis: 'inference',
				citations: []
			});
		}
	}
	for (const w of workaroundComments) {
		findings.push({
			severity: 'STOP',
			title: 'Changes code under a workaround comment',
			claims: [
				{
					text: `The comment at ${w.path.split('/').pop()}:${w.line} says: "${w.comment}".`,
					status: 'verified',
					basis: 'comment_statement',
					citations: [
						cite({ kind: 'code', commit: mb, path: w.path, start: w.line, end: w.line }, w.comment)
					]
				}
			]
		});
	}
	const contract = signalsHit.filter((s) => CONTRACT_SIGNALS.has(s.kind));
	if (contract.length) {
		findings.push({
			severity: 'DANGEROUS',
			title: `Touches ${[...new Set(contract.map((s) => s.kind.replace('_', ' ')))].join(', ')} code`,
			claims: contract.slice(0, 6).map((s) => ({
				text: `${s.path.split('/').pop()}:${s.line} (${s.kind}): \`${s.snippet}\``,
				status: 'verified' as const,
				basis: 'code_fact' as const,
				citations: [
					cite(
						{ kind: 'code', commit: s.commit, path: s.path, start: s.line, end: s.line },
						s.snippet
					)
				]
			}))
		});
	}
	if (behaviourFree) {
		findings.push({
			severity: 'INFO',
			title: 'Behaviour-free change',
			claims: classes.map((c) => ({
				text: `${c.path}: ${c.class === 'docs' ? 'documentation only' : c.class === 'log_string' ? 'only log/message strings change' : 'only comments and whitespace change'} (token-level comparison of both versions).`,
				status: 'verified' as const,
				basis: 'code_fact' as const,
				citations: [
					cite({ kind: 'code', commit: pull.headSha, path: c.path, start: 1, end: 1 }, c.path)
				]
			}))
		});
	}
	if (!behaviourFree && completeness !== 'complete') {
		findings.push({
			severity: 'RISKY',
			title: `Analysis is ${completeness}`,
			claims: reasons.map((r) => ({
				text: `Impact unknown where: ${r.text}.`,
				status: 'unknown' as const,
				basis: 'inference' as const,
				citations: []
			}))
		});
	}
	if (!behaviourFree && missing.length) {
		findings.push({
			severity: 'RISKY',
			title: 'No related test found',
			claims: [
				{
					text: `No test file references ${missing.slice(0, 4).join(', ')}. Executed coverage is not measured (out of scope for this tool).`,
					status: 'unknown',
					basis: 'inference',
					citations: []
				}
			]
		});
	}

	// Assumptions the touched code relies on (timing / HW), whole-function view.
	const assumptions: Claim[] = [];
	for (const t of [...touched.values()].filter((x) => x.side === 'base')) {
		for (const s of model.signals
			.filter(
				(x) =>
					x.path === t.path &&
					x.start >= t.start &&
					x.start <= t.end &&
					['timing', 'timing_constant', 'hw_register', 'watchdog', 'isr'].includes(x.kind)
			)
			.slice(0, 4)) {
			assumptions.push({
				text: `${t.name.split('::').pop()} relies on ${s.kind.replace('_', ' ')} at line ${s.start}: \`${s.snippet}\``,
				status: 'verified',
				basis: 'code_fact',
				citations: [
					cite({ kind: 'code', commit: mb, path: s.path, start: s.start, end: s.start }, s.snippet)
				]
			});
		}
	}

	const rationale = behaviourFree
		? 'Only comments, whitespace, log strings or docs change, so behaviour is unchanged (checked token by token on both versions).'
		: floorReasons
				.filter((r) => r.verdict === floor)
				.slice(0, 3)
				.map((r) => `${r.verdict}: ${r.detail}.`)
				.join(' ');

	return {
		evidence,
		result: {
			pull,
			diff: display,
			snapshots: {
				mergeBase: mb,
				base: pull.baseSha,
				head: pull.headSha,
				mergeBaseDiffers: mb !== pull.baseSha
			},
			scope: { deepScope, fromScan: scanCovers ? input.scanScope!.scanId : null },
			changeClass: { overall: behaviourFree ? 'behaviour_free' : 'code', files: classes },
			verdict: floor,
			floor,
			floorReasons,
			completeness: { level: completeness, reasons: reasons.map((r) => r.text) },
			touched: [...touched.values()],
			impact,
			tests: {
				related,
				missing,
				note: 'Related = a test file names the touched code (static match). Not coverage: nothing was executed.'
			},
			findings: findings.sort((a, b) => sevRank(b.severity) - sevRank(a.severity)),
			openQuestions,
			rationale: { text: rationale, source: 'rules' },
			assumptions,
			llm: { used: false, downgrades: 0 },
			stats: {
				files: diffs.length,
				hunks: diffs.reduce((n, d) => n + d.hunks.length, 0),
				ms: Date.now() - t0
			}
		}
	};
}

const sevRank = (s: Verdict | 'INFO') =>
	s === 'INFO' ? -1 : { SAFE: 0, RISKY: 1, DANGEROUS: 2, STOP: 3 }[s];
