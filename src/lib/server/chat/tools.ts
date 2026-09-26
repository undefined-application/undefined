// Chat tools over the system model (plan §5 Tab 2). Each call returns text for the model plus
// evidence items it may cite; nothing reads the whole codebase.

import type { Citation } from '$lib/claims';
import type { EvidenceItem } from '$lib/server/evidence/validate';
import { computeImpact } from '$lib/server/evidence/impact';
import { EXPLICIT_WORKAROUND } from '$lib/server/review/rules';
import { git } from '$lib/server/scan/git';
import { lineHistory } from '$lib/server/scan/gitmine';
import type { SnapshotView } from '$lib/server/scan/views';

export interface ToolContext {
	view: SnapshotView;
	/** Bare clone of the repo (for code, blame and line history). */
	dir: string;
	evidence: EvidenceItem[];
}

export interface ToolResult {
	/** What the model sees; evidence ids appear as `[E3]`. */
	text: string;
}

const MAX_CODE_LINES = 80;
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

function addEvidence(ctx: ToolContext, citation: Citation, text: string): string {
	const id = `E${ctx.evidence.length + 1}`;
	ctx.evidence.push({ id, citation, text });
	return id;
}

async function readLines(ctx: ToolContext, path: string, start: number, end: number) {
	const text = await git(['show', `${ctx.view.commit}:${path}`], { cwd: ctx.dir });
	const lines = text.split('\n');
	const s = Math.max(1, start);
	const e = Math.min(lines.length, end, s + MAX_CODE_LINES - 1);
	return { s, e, body: lines.slice(s - 1, e).join('\n'), total: lines.length };
}

const words = (s: string) => s.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [];

/** Keyword search over symbols, signals and commit messages (BM25-lite, in memory). */
function search(ctx: ToolContext, query: string): ToolResult {
	const q = [...new Set(words(query))];
	if (!q.length) return { text: 'Empty query.' };
	const score = (hay: string) => {
		const h = hay.toLowerCase();
		return q.reduce((n, w) => n + (h.includes(w) ? 1 + (h.split(w).length - 2) * 0.2 : 0), 0);
	};
	const hits: { score: number; line: string }[] = [];
	for (const s of ctx.view.symbols) {
		if (s.kind === 'macro') continue;
		const sc = score(`${s.name} ${s.path}`) * 2;
		if (sc > 0)
			hits.push({
				score: sc + s.criticality / 20,
				line: `symbol ${s.name} — ${s.path}:${s.start}-${s.end} (criticality ${s.level})`
			});
	}
	for (const sig of ctx.view.signals) {
		if (sig.source === 'git') continue;
		const sc = score(`${sig.snippet} ${sig.kind}`);
		if (sc > 0)
			hits.push({ score: sc, line: `${sig.kind} at ${sig.path}:${sig.start}: ${sig.snippet}` });
	}
	for (const c of ctx.view.commits.values()) {
		const sc = score(`${c.subject} ${c.body}`) * 1.2;
		if (sc > 0)
			hits.push({
				score: sc,
				line: `commit ${c.sha.slice(0, 10)} ${c.authoredAt.toISOString().slice(0, 10)} "${c.subject}" (files: ${c.files.map(base).slice(0, 3).join(', ')})`
			});
	}
	const top = hits.sort((a, b) => b.score - a.score).slice(0, 12);
	return { text: top.length ? top.map((h) => `- ${h.line}`).join('\n') : 'No matches.' };
}

async function getSymbol(ctx: ToolContext, name: string): Promise<ToolResult> {
	const n = name.trim();
	const matches = ctx.view.symbols.filter(
		(s) => s.name === n || s.shortName === n || s.name.endsWith(`::${n}`)
	);
	if (!matches.length) return { text: `No symbol named ${n} in the deep scope.` };
	const out: string[] = [];
	for (const s of matches.slice(0, 3)) {
		const { s: a, e, body } = await readLines(ctx, s.path, s.start, s.end);
		const id = addEvidence(
			ctx,
			{ kind: 'code', commit: ctx.view.commit, path: s.path, start: a, end: e },
			body
		);
		out.push(
			`[${id}] ${s.kind} ${s.name} at ${s.path}:${s.start}-${s.end}${e < s.end ? ` (first ${e - a + 1} lines shown)` : ''}\n` +
				`criticality ${s.level} (${s.criticality}): ${s.factors.map((f) => `${f.factor}+${f.points} ${f.detail}`).join('; ') || 'no signals'}\n` +
				'```\n' +
				body +
				'\n```'
		);
	}
	if (matches.length > 3) out.push(`(${matches.length - 3} more with the same name)`);
	return { text: out.join('\n\n') };
}

async function getCode(
	ctx: ToolContext,
	path: string,
	start: number,
	end: number
): Promise<ToolResult> {
	if (!ctx.view.files.some((f) => f.path === path))
		return { text: `${path} is not a source file in the deep scope.` };
	const { s, e, body, total } = await readLines(ctx, path, start, end || start + 40);
	const id = addEvidence(
		ctx,
		{ kind: 'code', commit: ctx.view.commit, path, start: s, end: e },
		body
	);
	return { text: `[${id}] ${path}:${s}-${e} (of ${total})\n\`\`\`\n${body}\n\`\`\`` };
}

function neighbours(ctx: ToolContext, name: string, dir: 'callers' | 'callees'): ToolResult {
	const syms = ctx.view.symbols.filter(
		(s) => s.name === name || s.shortName === name || s.name.endsWith(`::${name}`)
	);
	if (!syms.length) return { text: `No symbol named ${name}.` };
	const ids = new Set(syms.map((s) => s.id));
	const byId = new Map(ctx.view.symbols.map((s) => [s.id, s]));
	const lines: string[] = [];
	let outside = 0;
	for (const e of ctx.view.edges) {
		if (e.kind === 'co_changes') continue;
		const mine = dir === 'callers' ? ids.has(e.to) : ids.has(e.from);
		if (!mine) continue;
		const other = dir === 'callers' ? e.from : e.to;
		if (e.method === 'reference_index') outside++;
		const sym = byId.get(other);
		lines.push(
			`- ${sym ? sym.name : other} [${e.kind}, ${e.resolution}${e.method === 'reference_index' ? ', outside scope, name match' : ''}]`
		);
	}
	const note =
		dir === 'callers' && outside
			? `\n${outside} reference(s) come from outside the deep scope (name/include match only).`
			: '';
	return {
		text:
			(lines.length
				? lines.slice(0, 40).join('\n')
				: `No ${dir} found in the analysed scope. That does not prove there are none.`) + note
	};
}

function signalsFor(ctx: ToolContext, target: string): ToolResult {
	const sym = ctx.view.symbols.find(
		(s) => s.name === target || s.shortName === target || s.name.endsWith(`::${target}`)
	);
	const sigs = ctx.view.signals.filter((s) =>
		sym
			? s.path === sym.path && s.start >= sym.start && s.start <= sym.end
			: s.path === target || base(s.path) === target
	);
	if (!sigs.length) return { text: `No signals for ${target}.` };
	const out = sigs.slice(0, 25).map((s) => {
		if (s.source === 'git') {
			const c = ctx.view.commits.get(s.detail);
			const id = c
				? addEvidence(
						ctx,
						{ kind: 'commit', sha: c.sha, subject: c.subject },
						`${c.subject}\n${c.body}`
					)
				: null;
			return `- ${s.kind} ${base(s.path)}:${s.start}-${s.end}: last written by ${s.detail.slice(0, 10)} "${s.snippet}"${id ? ` [${id}]` : ''}`;
		}
		const id = addEvidence(
			ctx,
			{ kind: 'code', commit: ctx.view.commit, path: s.path, start: s.start, end: s.end },
			s.snippet
		);
		return `- [${id}] ${s.kind} ${base(s.path)}:${s.start}: ${s.snippet}`;
	});
	return { text: out.join('\n') };
}

async function history(
	ctx: ToolContext,
	path: string,
	start: number,
	end: number
): Promise<ToolResult> {
	const h = await lineHistory(ctx.dir, ctx.view.commit, path, start, end || start, 8);
	if (!h.entries.length) return { text: 'No history found for those lines.' };
	const out = h.entries.map((e) => {
		const id = addEvidence(
			ctx,
			{ kind: 'commit', sha: e.sha, subject: e.subject },
			`${e.subject}\n${e.body}\nadded:\n${e.added.slice(0, 12).join('\n')}`
		);
		const flags = [
			e.revert && 'REVERT',
			EXPLICIT_WORKAROUND.test(`${e.subject}\n${e.body}`) && 'WORKAROUND',
			e.bugfix && 'bugfix'
		]
			.filter(Boolean)
			.join(',');
		return `[${id}] ${e.sha.slice(0, 10)} ${new Date(e.authoredAt).toISOString().slice(0, 10)} ${e.authorName} <${e.authorEmail}> ${flags ? `(${flags}) ` : ''}"${e.subject}"\n${e.body.slice(0, 500)}`;
	});
	return { text: out.join('\n\n') + (h.truncated ? '\n(history continues further back)' : '') };
}

/** "Can I change this?" (plan §5 Tab 2): the deterministic facts the Tab 4 floor would use. */
async function changeRisk(ctx: ToolContext, path: string, line: number): Promise<ToolResult> {
	const lines: string[] = [];
	const h = await history(ctx, path, line, line);
	lines.push('Line history:\n' + h.text);
	const onLine = ctx.view.signals.filter(
		(s) => s.path === path && s.start <= line && line <= s.end && s.source !== 'git'
	);
	lines.push(`Signals on the line: ${onLine.map((s) => s.kind).join(', ') || 'none'}`);
	const fn = ctx.view.symbols
		.filter((s) => s.kind === 'function' && s.path === path && s.start <= line && line <= s.end)
		.sort((a, b) => a.end - a.start - (b.end - b.start))[0];
	if (fn) {
		const imp = computeImpact(
			{
				edges: ctx.view.edges,
				symbols: ctx.view.symbols,
				deepPaths: new Set(ctx.view.files.map((f) => f.path))
			},
			[fn.id],
			{ depth: 3 }
		);
		lines.push(
			`Enclosing function ${fn.name} (criticality ${fn.level}). Dependents within 3 hops: ${imp.nodes.length} (${imp.counts.ambiguous} ambiguous, ${imp.counts.unresolved} unresolved, ${imp.counts.boundary} outside scope): ${imp.nodes
				.slice(0, 10)
				.map((n) => n.label)
				.join(', ')}`
		);
	}
	lines.push(
		'Rules: a line shaped by a revert or an explicit workaround commit → STOP; bug-fix history or a timing/ISR/HW/interface signal → DANGEROUS; incomplete analysis → at least RISKY.'
	);
	return { text: lines.join('\n\n') };
}

export const TOOL_DOCS = `Tools (call one at a time):
- search {"query": string}: keyword search over symbols, signals and commit messages
- get_symbol {"name": string}: definition, criticality and code of a function/class
- get_code {"path": string, "start": number, "end": number}: source lines at the snapshot
- callers {"name": string} / callees {"name": string}: dependency edges with resolution status
- signals {"target": symbol name or file path}: embedded signals (timing, ISR, HW, workaround comments, git risk)
- history {"path": string, "start": number, "end": number}: every commit that shaped these lines (git log -L)
- change_risk {"path": string, "line": number}: can this line be changed? history + signals + dependents`;

export async function runTool(
	ctx: ToolContext,
	name: string,
	args: Record<string, unknown>
): Promise<ToolResult> {
	const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '');
	const num = (k: string) => (Number.isFinite(Number(args[k])) ? Number(args[k]) : 0);
	switch (name) {
		case 'search':
			return search(ctx, str('query'));
		case 'get_symbol':
			return getSymbol(ctx, str('name'));
		case 'get_code':
			return getCode(ctx, str('path'), num('start') || 1, num('end'));
		case 'callers':
		case 'callees':
			return neighbours(ctx, str('name'), name);
		case 'signals':
			return signalsFor(ctx, str('target'));
		case 'history':
			return history(ctx, str('path'), num('start') || 1, num('end'));
		case 'change_risk':
			return changeRisk(ctx, str('path'), num('line') || 1);
		default:
			return { text: `Unknown tool "${name}".` };
	}
}
