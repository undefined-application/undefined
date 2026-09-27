// Stage 5/6: the model's part of the wiki, in one call: the two-sentence overview, the architecture
// as layers, and what each file to start with does. The scan supplies every fact; the model only
// names and explains. Intro sentences are claims validated against the evidence packet (plan
// §4.5.5); layer members must be names the scan found on that side, and file lines must belong to
// the reading order, or they are dropped. Cached by input hash.

import type { Citation } from '$lib/claims';
import type { ArchLayer, Fence, OnboardingPack, WikiOverview } from '$lib/model';
import { validateClaims, type EvidenceItem } from '$lib/server/evidence/validate';
import { parseJsonAll, type Llm } from '$lib/server/llm/core';

export const PROMPT_ID = 'wiki-overview.v2';

const SYSTEM = `You write the opening of a wiki page about one subsystem of a legacy embedded codebase, for an
engineer about to work on it. You get what analysis found: who uses the subsystem, its components (with
some of their files), what it depends on, places whose history says not to touch them, the first lines
of the files to start with, and an evidence packet E1..En.

Reply with exactly one JSON object and nothing else:
{"sentences": [...], "layers": [...], "files": [...]}

sentences: exactly 2, each at most 22 words, together a brief overview of the whole subsystem:
(1) what it is and does, in plain words; (2) how it fits in: what relies on it and what it runs on.
No module or file lists, no single line or commit.
Each sentence is a claim:
{"text": "...", "status": "verified|inferred|unknown", "confidence": "low|medium|high",
 "basis": "code_fact|commit_statement|comment_statement|inference", "cite": ["E1"]}

layers: the architecture as a reader should picture it, top to bottom, 3 to 5 layers:
- one layer with side "above": the code that uses the subsystem (members from "Used by");
- one or two layers with side "inside": how the subsystem splits, e.g. a core and its hardware drivers
  (members from "Components");
- one layer with side "below": what it runs on (members from "Depends on").
Each: {"side": "above|inside|below", "title": "2 to 4 words", "role": "one plain sentence, at most 14 words",
 "members": ["names copied exactly from the lists, most important first"]}

files: for each file under "Files to start with", one plain sentence of at most 14 words on what it does:
{"path": "the exact path", "what": "..."}

Rules for sentences, all mandatory: cite only evidence ids from the packet; "verified" only when a cited
item states it directly; purpose and consequences are "inferred" unless a commit message or comment
says so; prefer "unknown" to guessing.`;

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const short = (name: string) => name.replace(/ \+\d+$/, '');
const clipWords = (s: string, n: number) =>
	s.length <= n ? s : `${s.slice(0, s.lastIndexOf(' ', n - 1)).replace(/[,;:]$/, '')}…`;

export async function wikiOverview(
	pack: OnboardingPack,
	llm: Llm,
	fences: Fence[] = [],
	heads: Map<string, string> = new Map()
): Promise<WikiOverview & { tokens: number }> {
	const { architecture: arch } = pack;
	const evidence: EvidenceItem[] = [];
	const add = (citation: Citation, text: string) => {
		const id = `E${evidence.length + 1}`;
		evidence.push({ id, citation, text });
		return id;
	};
	const code = (path: string, start: number, end = start): Citation => ({
		kind: 'code',
		commit: pack.commit,
		path,
		start,
		end
	});
	const includeLine = (inc: { path: string; line: number; header: string }) =>
		add(code(inc.path, inc.line), `${inc.path}:${inc.line} includes ${inc.header}`);

	const usedBy = arch.usedBy
		.slice(0, 14)
		.map(
			(u, i) => `- ${u.name}: ${u.files} files${i < 6 ? ` [${includeLine(u.includes[0])}]` : ''}`
		);
	const dependsOn = arch.dependsOn
		.slice(0, 14)
		.map(
			(d, i) =>
				`- ${d.name}: included by ${d.files} files${i < 6 ? ` [${includeLine(d.includes[0])}]` : ''}`
		);
	const components = pack.components.map(
		(c) =>
			`- ${short(c.name)}: ${c.files.length} files (${c.files.slice(0, 5).map(base).join(', ')}${c.files.length > 5 ? ', …' : ''})`
	);
	const guards = fences.slice(0, 3).map((f) => {
		const ids = [
			add(code(f.path, f.start, f.end), f.code.lines.join('\n')),
			f.origin &&
				add(
					{ kind: 'commit', sha: f.origin.sha, subject: f.origin.subject },
					`${f.origin.author}, ${f.origin.date.slice(0, 10)}: ${f.origin.subject}${f.origin.said !== f.origin.subject ? `\n${f.origin.said}` : ''}`
				),
			f.reverted &&
				add(
					{ kind: 'commit', sha: f.reverted.revert.sha, subject: f.reverted.revert.subject },
					`${f.reverted.revert.author}, ${f.reverted.revert.date.slice(0, 10)}: ${f.reverted.revert.subject}${f.reverted.reason ? `\n${f.reverted.reason}` : ''}`
				)
		].filter(Boolean);
		return `- ${f.verdict} if changed: ${f.title} (${f.fn.name}, ${base(f.path)})${f.reverted ? `; a change to it was reverted ${f.reverted.days} days later` : ''} [${ids.join(', ')}]`;
	});
	const files = pack.readingOrder.map((r) => {
		const head = heads.get(r.path);
		const id = head ? add(code(r.path, 1, head.split('\n').length), head) : null;
		return `- ${r.path}${r.functions.length ? ` (key functions: ${r.functions.join(', ')})` : ''}${id ? ` [${id}]` : ''}`;
	});

	const user = [
		`Repo ${pack.repo}, subsystem ${pack.deepScope || '(whole repo)'} at ${pack.commit.slice(0, 10)}.`,
		arch.publicHeader ? `Public interface: ${base(arch.publicHeader)}.` : '',
		'Used by (module: files that include it):',
		...(usedBy.length ? usedBy : ['- nothing outside the subsystem']),
		'Components (name: files):',
		...components,
		'Depends on (module: files in the subsystem that include it):',
		...(dependsOn.length ? dependsOn : ['- nothing outside the subsystem']),
		...(guards.length ? ['Do not break:', ...guards] : []),
		'Files to start with:',
		...files,
		'',
		'Evidence packet:',
		...evidence.map((e) => {
			const where =
				e.citation.kind === 'code'
					? `code ${e.citation.path}:${e.citation.start}-${e.citation.end}`
					: `commit ${e.citation.sha.slice(0, 10)}`;
			return `${e.id} [${where}]\n${e.text}`;
		})
	]
		.filter(Boolean)
		.join('\n');

	const res = await llm.chat({
		tier: 'strong',
		promptId: PROMPT_ID,
		// Reasoning models think inside this budget before they answer: 2500 left them no room.
		maxTokens: 8000,
		messages: [
			{ role: 'system', content: SYSTEM },
			{ role: 'user', content: user }
		]
	});
	const objects = parseJsonAll<Record<string, unknown>>(res.text);
	const { claims, downgrades } = validateClaims(sentencesOf(res.text), evidence);
	const layers = layersOf(
		objects.flatMap((o) => (Array.isArray(o?.layers) ? o.layers : [])),
		{
			above: arch.usedBy.map((u) => u.name),
			inside: pack.components.map((c) => short(c.name)),
			below: arch.dependsOn.map((d) => d.name)
		}
	);
	const described = filesOf(
		objects.flatMap((o) => (Array.isArray(o?.files) ? o.files : [])),
		pack.readingOrder.map((r) => r.path)
	);
	if (!claims.length && !layers && !Object.keys(described).length)
		throw new Error('the model returned no overview');
	return {
		claims: claims.slice(0, 2),
		layers,
		files: described,
		model: res.model,
		cached: res.cached,
		downgrades: downgrades.length,
		tokens: res.promptTokens + res.completionTokens
	};
}

/** Sentences as asked (`{"sentences": [...]}`), or as claim objects the model split the answer into. */
export function sentencesOf(text: string): unknown[] {
	const objects = parseJsonAll<Record<string, unknown>>(text);
	const listed = objects.flatMap((o) => (Array.isArray(o?.sentences) ? o.sentences : []));
	return listed.length ? listed : objects.filter((o) => typeof o?.text === 'string');
}

const LIMIT: Record<ArchLayer['side'], number> = { above: 2, inside: 3, below: 2 };

/**
 * The model's layers, kept only where they hold up: each member must be a name the scan found on
 * that side (spelled as the scan spells it), a layer needs members, and there must be an inside
 * layer. Null when nothing usable is left: the page then draws its own layers.
 */
export function layersOf(
	raw: unknown[],
	pools: Record<ArchLayer['side'], string[]>
): ArchLayer[] | null {
	const used = new Set<string>();
	const count: Record<ArchLayer['side'], number> = { above: 0, inside: 0, below: 0 };
	const out: ArchLayer[] = [];
	for (const r of raw as Record<string, unknown>[]) {
		const side = r?.side as ArchLayer['side'];
		if (!(side in LIMIT) || count[side] >= LIMIT[side]) continue;
		const byName = new Map(pools[side].map((n) => [n.toLowerCase(), n]));
		const members = (Array.isArray(r.members) ? r.members : [])
			.map((m) => (typeof m === 'string' ? byName.get(m.trim().toLowerCase()) : undefined))
			.filter((m): m is string => !!m && !used.has(`${side}:${m}`));
		if (!members.length || typeof r.title !== 'string' || !r.title.trim()) continue;
		for (const m of members) used.add(`${side}:${m}`);
		count[side]++;
		out.push({
			side,
			title: clipWords(r.title.trim(), 40),
			role: typeof r.role === 'string' ? clipWords(r.role.trim(), 120) : '',
			members
		});
	}
	if (!out.some((l) => l.side === 'inside')) return null;
	const order = { above: 0, inside: 1, below: 2 };
	return out.sort((a, b) => order[a.side] - order[b.side]);
}

/** One line per reading-order file; anything else the model describes is dropped. */
export function filesOf(raw: unknown[], paths: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const r of raw as Record<string, unknown>[]) {
		const path = paths.find((p) => p === r?.path || base(p) === r?.path);
		if (path && typeof r.what === 'string' && r.what.trim() && !out[path])
			out[path] = clipWords(r.what.trim(), 120);
	}
	return out;
}
