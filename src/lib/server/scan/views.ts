// Read side of the system model (plan §4.4): Tabs 1–3 query this, never the raw code.
// Pure functions over one snapshot's stored rows; loading lives in `model.ts`.

import { error } from '@sveltejs/kit';
import type { Citation, Claim, Person } from '$lib/claims';
import type {
	Architecture,
	ComponentInfo,
	Coupling,
	CriticalPart,
	Fence,
	GraphData,
	GraphEdge,
	GraphLevel,
	GraphNode,
	Level,
	ModuleLink,
	NodeDetails,
	OnboardingPack,
	Reach,
	Resolution
} from '$lib/model';
import type { ScanStats } from '$lib/scan';
import type {
	blameRange,
	codeSignal,
	codeSymbol,
	component,
	edge,
	fileHistory,
	fileModel,
	gitAuthor,
	gitCommit
} from '$lib/server/db/schema';
import { computeImpact, type Impact } from '$lib/server/evidence/impact';

/** Everything stored for one snapshot, in memory. */
export interface SnapshotView {
	snapId: string;
	repo: string;
	commit: string;
	deepScope: string;
	stats: ScanStats | null;
	files: (typeof fileModel.$inferSelect)[];
	symbols: (typeof codeSymbol.$inferSelect)[];
	signals: (typeof codeSignal.$inferSelect)[];
	components: (typeof component.$inferSelect)[];
	edges: (typeof edge.$inferSelect)[];
	commits: Map<string, typeof gitCommit.$inferSelect>;
	history: Map<string, typeof fileHistory.$inferSelect>;
	blame: (typeof blameRange.$inferSelect)[];
	authors: Map<string, typeof gitAuthor.$inferSelect>;
}

type Loaded = SnapshotView;

const fileOf = (id: string) =>
	id.startsWith('file:')
		? id.slice(5)
		: id.startsWith('sym:')
			? id.slice(4, id.indexOf('#'))
			: null;
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));

export function person(m: Loaded, sha: string): Person | null {
	const c = m.commits.get(sha);
	if (!c) return null;
	return {
		name: c.authorName,
		email: c.authorEmail,
		sha: c.sha,
		date: c.authoredAt.toISOString(),
		subject: c.subject,
		login: m.authors.get(c.authorEmail.toLowerCase())?.githubLogin ?? null
	};
}

const code = (m: Loaded, path: string, start: number, end = start): Citation => ({
	kind: 'code',
	commit: m.commit,
	path,
	start,
	end
});
const commitCite = (sha: string, subject: string): Citation => ({ kind: 'commit', sha, subject });

/**
 * The commit that best explains a line range: lines it wrote, weighted by what its message
 * says (revert ×4, HW/timing rationale ×3, bug fix ×2).
 */
function keyCommitIn(m: Loaded, path: string, start: number, end: number) {
	const lines = new Map<string, number>();
	for (const b of m.blame) {
		if (b.path !== path || b.end < start || b.start > end) continue;
		const n = Math.min(b.end, end) - Math.max(b.start, start) + 1;
		lines.set(b.sha, (lines.get(b.sha) ?? 0) + n);
	}
	let best: { c: typeof gitCommit.$inferSelect; score: number } | undefined;
	for (const [sha, n] of lines) {
		const c = m.commits.get(sha);
		if (!c) continue;
		const score = n * (c.revert ? 4 : c.rationale ? 3 : c.bugfix ? 2 : 1);
		if (!best || score > best.score) best = { c, score };
	}
	return best?.c;
}

const ASSUMPTION_LABEL: Record<string, string> = {
	isr: 'Interrupt',
	timing: 'Timing',
	timing_constant: 'Timing constant',
	watchdog: 'Watchdog',
	hw_register: 'Register access',
	hw_access: 'Hardware access'
};

/** Commit that wrote `line` of `path` at the snapshot (blame). */
export function blameAt(m: Loaded, path: string, line: number) {
	const r = m.blame.find((b) => b.path === path && b.start <= line && line <= b.end);
	return r ? m.commits.get(r.sha) : undefined;
}

// ---------------------------------------------------------------- Tab 1: onboarding pack

export function onboardingPack(m: Loaded): OnboardingPack {
	const signalsIn = (path: string, start: number, end: number) =>
		m.signals.filter((s) => s.path === path && s.start >= start && s.start <= end);

	// Critical-parts register: top functions by score, each with cited evidence.
	const critical: CriticalPart[] = m.symbols
		.filter((s) => s.kind === 'function' && s.criticality > 0)
		.sort((a, b) => b.criticality - a.criticality)
		.slice(0, 15)
		.map((s) => {
			const sigs = signalsIn(s.path, s.start, s.end);
			const claims: Claim[] = [];
			for (const sig of sigs.filter((x) => x.source === 'static').slice(0, 4)) {
				claims.push({
					text: `L${sig.start} (${sig.kind.replace('_', ' ')}): \`${sig.snippet}\``,
					status: 'verified',
					basis: 'code_fact',
					citations: [code(m, s.path, sig.start)]
				});
			}
			for (const sig of sigs.filter((x) => x.kind === 'workaround_comment').slice(0, 2)) {
				claims.push({
					text: `Comment at L${sig.start}: "${sig.snippet}"`,
					status: 'verified',
					basis: 'comment_statement',
					citations: [code(m, s.path, sig.start)]
				});
			}
			const gitSigs = sigs
				.filter((x) => x.source === 'git')
				.sort((a, b) => b.weight - a.weight)
				.filter((x, i, all) => all.findIndex((y) => y.detail === x.detail) === i)
				.slice(0, 3);
			for (const sig of gitSigs) {
				const c = m.commits.get(sig.detail);
				if (!c) continue;
				const what = c.revert
					? 'a revert'
					: c.rationale
						? 'a HW/timing-rationale commit'
						: 'a bug-fix commit';
				claims.push({
					text: `L${sig.start}${sig.end > sig.start ? `–${sig.end}` : ''} last written by ${what}, ${c.sha.slice(0, 10)} (${c.authorName}, ${c.authoredAt.toISOString().slice(0, 10)}): "${c.subject}"`,
					status: 'verified',
					basis: 'commit_statement',
					citations: [commitCite(c.sha, c.subject), code(m, s.path, sig.start, sig.end)]
				});
			}
			const keySha = gitSigs[0]?.detail;
			const top = m.history.get(s.path)?.topAuthors[0];
			const ask = keySha
				? person(m, keySha)
				: top
					? person(
							m,
							[...m.commits.values()].find(
								(c) => c.authorEmail.toLowerCase() === top.email && c.files.includes(s.path)
							)?.sha ?? ''
						)
					: null;
			return {
				id: s.id,
				name: s.name,
				path: s.path,
				start: s.start,
				end: s.end,
				score: s.criticality,
				level: s.level,
				component: s.component,
				factors: s.factors,
				claims,
				ask
			};
		});

	// Timing and hardware assumptions.
	const assumptionKinds = [
		'isr',
		'timing',
		'timing_constant',
		'watchdog',
		'hw_register',
		'hw_access'
	];
	const assumptions: Claim[] = m.signals
		.filter((s) => assumptionKinds.includes(s.kind) && s.source === 'static')
		.sort(
			(a, b) =>
				assumptionKinds.indexOf(a.kind) - assumptionKinds.indexOf(b.kind) ||
				a.path.localeCompare(b.path) ||
				a.start - b.start
		)
		.filter((s, i, all) => all.findIndex((x) => x.path === s.path && x.snippet === s.snippet) === i)
		.slice(0, 40)
		.map((s) => ({
			// The location is the citation; the text says what kind of assumption it is.
			text: `${ASSUMPTION_LABEL[s.kind] ?? s.kind}: \`${s.snippet}\``,
			status: 'verified' as const,
			basis: 'code_fact' as const,
			citations: [code(m, s.path, s.start)]
		}));

	// External interfaces: what code outside the deep scope includes or names, plus declared ones.
	const deepPaths = new Set(m.files.map((f) => f.path));
	const inbound = new Map<string, (typeof m.edges)[number][]>();
	for (const e of m.edges) {
		if (e.method !== 'reference_index') continue;
		const list = inbound.get(e.to) ?? [];
		list.push(e);
		inbound.set(e.to, list);
	}
	const symbolById = new Map(m.symbols.map((s) => [s.id, s]));
	const interfaces: Claim[] = [...inbound]
		.map(([to, list]) => ({ to, list, files: new Set(list.map((e) => e.from)).size }))
		// Resolved includes first (real interfaces), then by how many outside files use it.
		.sort(
			(a, b) =>
				Number(b.list.some((e) => e.resolution === 'resolved')) -
					Number(a.list.some((e) => e.resolution === 'resolved')) || b.files - a.files
		)
		.slice(0, 15)
		.map(({ to, list, files }) => {
			const ev = list[0].evidence as { path: string; line: number } | null;
			const sym = symbolById.get(to);
			const name = sym ? sym.name : base(fileOf(to) ?? to);
			const resolved = list.some((e) => e.resolution === 'resolved');
			const examples = [...new Set(list.map((e) => base(fileOf(e.from) ?? e.from)))]
				.slice(0, 3)
				.join(', ');
			const how = list[0].kind === 'includes' ? 'included by' : 'named in';
			return {
				text: `\`${name}\` is ${how} ${files} file(s) outside ${m.deepScope || 'the scope'} (e.g. ${examples})${resolved ? '' : ' — name match only'}.`,
				status: resolved ? ('verified' as const) : ('inferred' as const),
				confidence: resolved ? undefined : ('medium' as const),
				basis: resolved ? ('code_fact' as const) : ('inference' as const),
				citations: ev ? [code(m, ev.path, ev.line)] : []
			};
		});
	for (const s of m.signals.filter((x) => x.kind === 'external_interface').slice(0, 10)) {
		interfaces.push({
			text: `Declares \`${s.snippet}\``,
			status: 'verified',
			basis: 'code_fact',
			citations: [code(m, s.path, s.start)]
		});
	}

	// Hidden couplings: outside code that includes a header belonging to one module in the scope
	// (a driver's registers or internals) instead of the scope's public header. The public header
	// is the one most included from outside; a header belongs to the deep-scope source whose name
	// is its longest prefix (`X_registers.h` → `X.cpp`).
	const stem = (p: string) => base(p).replace(/\.[^.]+$/, '');
	const sourceByStem = new Map(
		m.files.filter((f) => /\.(c|cc|cpp|cxx)$/.test(f.path)).map((f) => [stem(f.path), f.path])
	);
	const ownerOf = (header: string) => {
		const s = stem(header);
		let best: string | null = null;
		for (const t of sourceByStem.keys()) {
			if ((s === t || s.startsWith(`${t}_`)) && t.length > (best?.length ?? 0)) best = t;
		}
		return best;
	};
	const outsideIncludes = new Map<string, { path: string; line: number }[]>();
	for (const e of m.edges) {
		if (e.method !== 'reference_index' || e.kind !== 'includes' || e.resolution !== 'resolved')
			continue;
		const ev = e.evidence as { path: string; line: number } | null;
		const header = fileOf(e.to);
		if (!ev || !header) continue;
		const list = outsideIncludes.get(header) ?? [];
		list.push({ path: ev.path, line: ev.line });
		outsideIncludes.set(header, list);
	}
	const publicHeader = [...outsideIncludes].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
	const publicOwner = publicHeader ? stem(publicHeader) : null;
	const couplings: Coupling[] = [...outsideIncludes]
		.map(([header, includers]) => ({ header, owner: ownerOf(header), includers }))
		.filter(
			(c): c is Coupling => c.header !== publicHeader && c.owner !== null && c.owner !== publicOwner
		)
		.map((c) => ({
			...c,
			owner: sourceByStem.get(c.owner)!,
			includers: c.includers.sort((a, b) => a.path.localeCompare(b.path))
		}))
		.sort((a, b) => b.includers.length - a.includers.length || a.header.localeCompare(b.header));

	// System at a glance: who includes the scope (reference index) and what the scope includes
	// (resolved includes out of the deep scope), grouped by module: a path's directory cut to the
	// deep scope's depth (`libraries/AP_Baro`, `ArduCopter`).
	const scopeDepth = Math.max(1, m.deepScope ? m.deepScope.split('/').length : 0);
	const moduleOf = (p: string) => dirOf(p).split('/').slice(0, scopeDepth).join('/') || p;
	type Link = { module: string; file: string; path: string; line: number; header: string };
	const links = (entries: Link[]): ModuleLink[] => {
		const byModule = new Map<string, Link[]>();
		for (const e of entries) {
			const list = byModule.get(e.module) ?? [];
			list.push(e);
			byModule.set(e.module, list);
		}
		return [...byModule]
			.map(([path, list]) => ({
				path,
				name: base(path),
				files: new Set(list.map((e) => e.file)).size,
				includes: list.slice(0, 3).map(({ path, line, header }) => ({ path, line, header })),
				count: list.length
			}))
			.sort((a, b) => b.files - a.files || b.count - a.count || a.name.localeCompare(b.name));
	};
	const usedBy = links(
		[...outsideIncludes].flatMap(([header, list]) =>
			list.map((i) => ({ module: moduleOf(i.path), file: i.path, ...i, header }))
		)
	);
	const dependsOn = links(
		m.edges.flatMap((e) => {
			if (e.kind !== 'includes' || e.resolution !== 'resolved' || e.method === 'reference_index')
				return [];
			const from = fileOf(e.from);
			const to = fileOf(e.to);
			const ev = e.evidence as { path: string; line: number } | null;
			if (!from || !to || !ev || !deepPaths.has(from) || deepPaths.has(to)) return [];
			return [{ module: moduleOf(to), file: from, path: ev.path, line: ev.line, header: to }];
		})
	);
	const componentOfFile = new Map(
		m.components.flatMap((c) => c.files.map((f) => [f, c.id] as const))
	);
	const architecture: Architecture = {
		publicHeader: publicHeader ?? null,
		usedBy,
		dependsOn,
		reachIn: couplings.flatMap((c) =>
			[...new Set(c.includers.map((i) => moduleOf(i.path)))].map((module) => ({
				module,
				header: c.header,
				component: componentOfFile.get(c.owner) ?? null
			}))
		)
	};

	// Open questions: workaround comments whose commit doesn't say why; open ends in the graph.
	const unknowns: Claim[] = [];
	for (const s of m.signals.filter((x) => x.kind === 'workaround_comment').slice(0, 40)) {
		const c = blameAt(m, s.path, s.start);
		if (c && (c.rationale || c.revert)) continue;
		unknowns.push({
			text: `The comment says "${s.snippet}", but ${c ? 'its commit doesn’t say why' : 'no commit explains it'}.`,
			status: 'unknown',
			basis: 'inference',
			citations: [code(m, s.path, s.start)],
			ask: c ? (person(m, c.sha) ?? undefined) : undefined
		});
		if (unknowns.length >= 12) break;
	}
	const openEnds = m.edges.filter((e) => e.resolution === 'unresolved').length;
	if (openEnds) {
		unknowns.push({
			text: `${openEnds} call(s) or include(s) could not be followed (function pointers, callbacks, generated headers): what they reach is unknown.`,
			status: 'unknown',
			basis: 'inference',
			citations: []
		});
	}

	// Components, reading order, mermaid.
	const components: ComponentInfo[] = m.components
		.sort((a, b) => b.criticality - a.criticality)
		.map((c) => ({
			id: c.id,
			name: c.name,
			files: c.files,
			criticality: c.criticality,
			level: c.level,
			top: m.symbols
				.filter((s) => s.component === c.id && s.kind === 'function' && s.criticality > 0)
				.sort((a, b) => b.criticality - a.criticality)
				.slice(0, 3)
				.map((s) => ({ id: s.id, name: s.name, level: s.level }))
		}));
	const includedBy = new Map<string, number>();
	for (const e of m.edges) {
		if (e.kind === 'includes' && e.resolution === 'resolved')
			includedBy.set(e.to, (includedBy.get(e.to) ?? 0) + 1);
	}
	const hubHeader = [...includedBy]
		.filter(([id]) => deepPaths.has(fileOf(id) ?? ''))
		.sort((a, b) => b[1] - a[1])[0];
	// Where to start: the public interface, then the most critical file of the top components,
	// each with the functions to look at first.
	const topFunctions = (path: string) =>
		m.symbols
			.filter((s) => s.path === path && s.kind === 'function' && s.criticality > 0)
			.sort((a, b) => b.criticality - a.criticality)
			.slice(0, 2)
			.map((s) => s.name.split('::').pop()!);
	const readingOrder: OnboardingPack['readingOrder'] = [];
	if (hubHeader) {
		const path = fileOf(hubHeader[0])!;
		readingOrder.push({
			path,
			why: `The interface everything else uses: included ${hubHeader[1]} times.`,
			functions: topFunctions(path)
		});
	}
	for (const c of components) {
		if (readingOrder.length >= 5) break;
		const f = m.files
			.filter((x) => c.files.includes(x.path))
			.sort((a, b) => b.criticality - a.criticality)[0];
		if (f && !readingOrder.some((r) => r.path === f.path)) {
			readingOrder.push({
				path: f.path,
				why: `The most critical file of ${c.name.replace(/ \+\d+$/, '')}.`,
				functions: topFunctions(f.path)
			});
		}
	}

	const compOf = new Map<string, string>();
	for (const c of m.components) for (const f of c.files) compOf.set(f, c.id);
	const deps = new Map<string, number>();
	for (const e of m.edges) {
		if (e.resolution !== 'resolved' || e.kind === 'co_changes' || e.method === 'reference_index')
			continue;
		const a = compOf.get(fileOf(e.from) ?? '');
		const b = compOf.get(fileOf(e.to) ?? '');
		if (a && b && a !== b) deps.set(`${a}\0${b}`, (deps.get(`${a}\0${b}`) ?? 0) + e.weight);
	}
	const mid = new Map(components.map((c, i) => [c.id, `C${i}`]));
	const mermaid = [
		'graph LR',
		...components.map(
			(c) => `  ${mid.get(c.id)}["${c.name.replace(/"/g, "'")} (${c.files.length})"]`
		),
		...[...deps].map(([k, w]) => {
			const [a, b] = k.split('\0');
			return `  ${mid.get(a)} -->|${w}| ${mid.get(b)}`;
		})
	].join('\n');

	const st = m.stats?.structure;
	// Scope caveats: only in the Markdown export, the UI shows the counts.
	const notes: string[] = [];
	if (st) {
		notes.push(
			`Deep scope: ${st.filesParsed} source files parsed${st.parseFailures ? `, ${st.parseFailures} failed` : ''}${st.unbalanced ? `, ${st.unbalanced} with unbalanced braces (symbol ranges unreliable)` : ''}.`
		);
		notes.push(
			`Dependency edges: ${st.edges.resolved} resolved, ${st.edges.ambiguous} ambiguous (same name, several candidates), ${st.edges.unresolved} unresolved (function pointers, generated headers).`
		);
		notes.push(
			`Reference index: ${st.referenceFiles} source files outside the deep scope indexed by name/include only; ${st.boundaryFiles} of them reference it.`
		);
		notes.push(
			`${st.externalCalls} call sites leave the deep scope (HAL, libraries): not followed.`
		);
	}
	notes.push(
		'Syntax-level C/C++ scan: overloads, virtual dispatch and macro-generated code are not resolved; #else/#elif branches are not analysed.'
	);
	notes.push(
		'Signals are keyword/pattern heuristics: they point at code worth reading, not proof of criticality.'
	);

	return {
		repo: m.repo,
		commit: m.commit,
		deepScope: m.deepScope,
		components,
		critical,
		architecture,
		couplings,
		assumptions,
		interfaces,
		unknowns,
		coverage: { stats: m.stats, notes },
		readingOrder,
		mermaid
	};
}

// ---------------------------------------------------------------- Tab 3: graph

const MAX_SYMBOL_NODES = 600;
const RES_RANK: Record<Resolution, number> = { resolved: 0, ambiguous: 1, unresolved: 2 };

export function graphData(
	m: Loaded,
	level: GraphLevel,
	opts: { file?: string; coChange?: boolean }
): GraphData {
	const deepPaths = new Set(m.files.map((f) => f.path));
	const compOf = new Map<string, string>();
	for (const c of m.components) for (const f of c.files) compOf.set(f, c.id);
	const kindsByPath = new Map<string, Set<string>>();
	for (const s of m.signals) {
		const set = kindsByPath.get(s.path) ?? new Set();
		set.add(s.kind);
		kindsByPath.set(s.path, set);
	}

	const nodes = new Map<string, GraphNode>();
	// Outside files collapse into their directory: one boundary node per directory.
	const boundaryNode = (path: string) => {
		const d = dirOf(path) || '.';
		const id = `dir:${d}`;
		const n = nodes.get(id);
		if (n) n.size++;
		else
			nodes.set(id, {
				id,
				label: `${d}/`,
				kind: 'boundary',
				path: d,
				component: null,
				level: 'low',
				score: 0,
				signals: [],
				boundary: true,
				size: 1
			});
		return id;
	};

	let mapId: (id: string) => string | null;
	if (level === 'component') {
		for (const c of m.components) {
			nodes.set(c.id, {
				id: c.id,
				label: c.name,
				kind: 'component',
				path: null,
				component: c.id,
				level: c.level,
				score: c.criticality,
				signals: [...new Set(c.files.flatMap((f) => [...(kindsByPath.get(f) ?? [])]))],
				boundary: false,
				size: c.files.length
			});
		}
		mapId = (id) => {
			const f = fileOf(id);
			if (!f) return null;
			return deepPaths.has(f) ? (compOf.get(f) ?? null) : boundaryNode(f);
		};
	} else if (level === 'file') {
		for (const f of m.files) {
			nodes.set(`file:${f.path}`, {
				id: `file:${f.path}`,
				label: base(f.path),
				kind: 'file',
				path: f.path,
				component: compOf.get(f.path) ?? null,
				level: f.level,
				score: f.criticality,
				signals: [...(kindsByPath.get(f.path) ?? [])],
				boundary: false,
				size: Math.max(1, Math.log2(f.lines))
			});
		}
		mapId = (id) => {
			const f = fileOf(id);
			if (!f) return null;
			return deepPaths.has(f) ? `file:${f}` : boundaryNode(f);
		};
	} else {
		const wanted = m.symbols
			.filter((s) => s.kind !== 'macro' || s.criticality > 0)
			.filter((s) => !opts.file || s.path === opts.file)
			.sort((a, b) => b.criticality - a.criticality)
			.slice(0, MAX_SYMBOL_NODES);
		for (const s of wanted) {
			const kinds = new Set(
				m.signals
					.filter((x) => x.path === s.path && x.start >= s.start && x.start <= s.end)
					.map((x) => x.kind)
			);
			nodes.set(s.id, {
				id: s.id,
				label: s.name,
				kind: s.kind,
				path: s.path,
				component: s.component,
				level: s.level,
				score: s.criticality,
				signals: [...kinds],
				boundary: false,
				size: 1
			});
		}
		mapId = (id) => {
			if (nodes.has(id)) return id;
			const f = fileOf(id);
			if (!f) return null;
			if (!deepPaths.has(f)) return boundaryNode(f);
			return opts.file && f !== opts.file ? `file:${f}` : null;
		};
	}

	const edges = new Map<string, GraphEdge>();
	for (const e of m.edges) {
		if (e.kind === 'co_changes' && !opts.coChange) continue;
		const a = mapId(e.from);
		const b = mapId(e.to);
		if (!a || !b || a === b) continue;
		// Drill-down: neighbouring files show up as plain file nodes.
		for (const id of [a, b]) {
			if (!nodes.has(id) && id.startsWith('file:')) {
				const p = id.slice(5);
				const f = m.files.find((x) => x.path === p);
				nodes.set(id, {
					id,
					label: base(p),
					kind: 'file',
					path: p,
					component: compOf.get(p) ?? null,
					level: f?.level ?? 'low',
					score: f?.criticality ?? 0,
					signals: [],
					boundary: false,
					size: 1
				});
			}
		}
		if (!nodes.has(a) || !nodes.has(b)) continue;
		const kind = e.kind === 'co_changes' ? 'co_changes' : e.kind;
		const key = `${a}\0${b}\0${kind}`;
		const cur = edges.get(key);
		const res = e.resolution as Resolution;
		if (cur) {
			cur.weight += e.weight;
			if (RES_RANK[res] < RES_RANK[cur.resolution]) cur.resolution = res;
		} else edges.set(key, { from: a, to: b, kind, resolution: res, weight: e.weight });
	}
	// Fan-in sizes symbols.
	if (level === 'symbol') {
		for (const e of edges.values()) {
			const n = nodes.get(e.to);
			if (n && e.kind !== 'co_changes') n.size += 1;
		}
	}
	// Keep the busiest boundary directories only.
	const boundary = [...nodes.values()].filter((n) => n.boundary).sort((a, b) => b.size - a.size);
	const cap = level === 'component' ? 12 : level === 'file' ? 25 : 30;
	const dropped = new Set(boundary.slice(cap).map((n) => n.id));
	for (const id of dropped) nodes.delete(id);
	return {
		level,
		nodes: [...nodes.values()],
		edges: [...edges.values()].filter((e) => !dropped.has(e.from) && !dropped.has(e.to)),
		truncated: dropped.size > 0 || (level === 'symbol' && m.symbols.length > MAX_SYMBOL_NODES)
	};
}

export function nodeDetails(m: Loaded, id: string): NodeDetails {
	const sym = m.symbols.find((s) => s.id === id);
	const path = sym?.path ?? fileOf(id);
	const comp = id.startsWith('comp:') ? m.components.find((c) => c.id === id) : undefined;
	const file = path ? m.files.find((f) => f.path === path) : undefined;
	if (!sym && !file && !comp) error(404, 'Node not found');

	const paths = comp ? comp.files : path ? [path] : [];
	const inRange = (s: { path: string; start: number }) =>
		sym
			? s.path === sym.path && s.start >= sym.start && s.start <= sym.end
			: paths.includes(s.path);
	const signals = m.signals
		.filter(inRange)
		.sort((a, b) => b.weight - a.weight)
		.slice(0, 30)
		.map((s) => ({
			kind: s.kind,
			source: s.source,
			path: s.path,
			line: s.start,
			snippet: s.snippet,
			detail: s.detail
		}));
	const commits = [...m.commits.values()]
		.filter((c) => c.files.some((f) => paths.includes(f)))
		.sort((a, b) => b.authoredAt.getTime() - a.authoredAt.getTime())
		.slice(0, 12)
		.map((c) => ({
			sha: c.sha,
			subject: c.subject,
			author: c.authorName,
			date: c.authoredAt.toISOString(),
			bugfix: c.bugfix,
			revert: c.revert,
			rationale: c.rationale
		}));
	const coChange = m.edges
		.filter(
			(e) =>
				e.kind === 'co_changes' && paths.some((p) => e.from === `file:${p}` || e.to === `file:${p}`)
		)
		.map((e) => {
			const other = paths.some((p) => e.from === `file:${p}`) ? e.to : e.from;
			const ev = e.evidence as { count: number; strength: number };
			return { path: other.slice(5), count: ev.count, strength: ev.strength };
		})
		.sort((a, b) => b.count - a.count)
		.slice(0, 8);
	const hist = paths.map((p) => m.history.get(p)).filter((h) => !!h);
	const authors = new Map<string, { name: string; email: string; commits: number }>();
	for (const h of hist) {
		for (const a of h!.topAuthors) {
			const cur = authors.get(a.email) ?? { ...a, commits: 0 };
			cur.commits += a.commits;
			authors.set(a.email, cur);
		}
	}

	const ids = new Set(
		sym
			? [sym.id]
			: [
					...paths.map((p) => `file:${p}`),
					...m.symbols.filter((s) => paths.includes(s.path)).map((s) => s.id)
				]
	);
	const counts = () => ({ resolved: 0, ambiguous: 0, unresolved: 0 }) as Record<Resolution, number>;
	const incoming = counts();
	const outgoing = counts();
	let outside = 0;
	for (const e of m.edges) {
		if (e.kind === 'co_changes') continue;
		const res = e.resolution as Resolution;
		if (ids.has(e.to) && !ids.has(e.from)) {
			incoming[res]++;
			if (e.method === 'reference_index') outside++;
		}
		if (ids.has(e.from) && !ids.has(e.to)) outgoing[res]++;
	}
	const top = [...authors.values()].sort((a, b) => b.commits - a.commits)[0];
	const askCommit = sym ? keyCommitIn(m, sym.path, sym.start, sym.end) : undefined;
	const ask = askCommit
		? person(m, askCommit.sha)
		: top
			? person(
					m,
					commits.find((c) => m.commits.get(c.sha)?.authorEmail.toLowerCase() === top.email)?.sha ??
						''
				)
			: null;

	const node: NodeDetails['node'] = sym
		? {
				id: sym.id,
				label: sym.name,
				kind: sym.kind,
				path: sym.path,
				component: sym.component,
				level: sym.level,
				score: sym.criticality,
				signals: [...new Set(signals.map((s) => s.kind))],
				boundary: false,
				size: 1,
				start: sym.start,
				end: sym.end,
				signature: sym.signature
			}
		: comp
			? {
					id: comp.id,
					label: comp.name,
					kind: 'component',
					path: null,
					component: comp.id,
					level: comp.level,
					score: comp.criticality,
					signals: [...new Set(signals.map((s) => s.kind))],
					boundary: false,
					size: comp.files.length
				}
			: {
					id: `file:${file!.path}`,
					label: base(file!.path),
					kind: 'file',
					path: file!.path,
					component: file!.component,
					level: file!.level,
					score: file!.criticality,
					signals: [...new Set(signals.map((s) => s.kind))],
					boundary: false,
					size: 1,
					start: 1,
					end: file!.lines
				};

	return {
		node,
		factors: sym?.factors ?? file?.factors ?? [],
		signals,
		commits,
		coChange,
		authors: [...authors.values()].sort((a, b) => b.commits - a.commits).slice(0, 5),
		edges: { incoming, outgoing, outside, externalCalls: sym?.externalCalls ?? 0 },
		ask
	};
}

/** A graph node's own ids: a component's files and symbols, a file and its symbols, or a symbol. */
function startIds(m: Loaded, id: string): string[] {
	const comp = m.components.find((c) => c.id === id);
	return comp
		? comp.files.flatMap((f) => [
				`file:${f}`,
				...m.symbols.filter((s) => s.path === f).map((s) => s.id)
			])
		: id.startsWith('file:')
			? [id, ...m.symbols.filter((s) => s.path === id.slice(5)).map((s) => s.id)]
			: [id];
}

const reverseEdges = new WeakMap<Loaded, Map<string, Loaded['edges']>>();

/** Dependents by target id, co-change excluded (correlation, not dependency). Built once per model. */
function dependentsIndex(m: Loaded) {
	let index = reverseEdges.get(m);
	if (!index) {
		index = new Map();
		for (const e of m.edges) {
			if (e.kind === 'co_changes') continue;
			const list = index.get(e.to) ?? [];
			list.push(e);
			index.set(e.to, list);
		}
		reverseEdges.set(m, index);
	}
	return index;
}

/** The blast radius meter: share of the analysed system that transitively depends on a node. */
export function reachOf(m: Loaded, id: string): Reach {
	const starts = startIds(m, id);
	const index = dependentsIndex(m);
	const deepPaths = new Set(m.files.map((f) => f.path));
	const symbolPath = new Map(
		m.symbols.filter((s) => s.kind !== 'macro').map((s) => [s.id, s.path] as const)
	);
	const compOf = new Map<string, string>();
	for (const c of m.components) for (const f of c.files) compOf.set(f, c.id);
	const own = new Set(starts.map((s) => fileOf(s)).filter((p): p is string => !!p));
	const ownComponents = new Set([...own].map((p) => compOf.get(p)).filter((c) => !!c));

	const seen = new Set(starts);
	const files = new Set<string>();
	const symbols = new Set<string>();
	const outside = new Set<string>();
	const byDepth: number[] = [];
	let ambiguous = 0;
	let unresolved = 0;
	let frontier = starts;
	for (let depth = 1; frontier.length; depth++) {
		const next: string[] = [];
		for (const cur of frontier) {
			for (const e of index.get(cur) ?? []) {
				if (e.resolution === 'ambiguous') ambiguous++;
				else if (e.resolution === 'unresolved') unresolved++;
				if (seen.has(e.from)) continue;
				seen.add(e.from);
				const path = fileOf(e.from);
				if (e.method === 'reference_index' || (path && !deepPaths.has(path))) {
					outside.add(path ?? e.from);
					continue;
				}
				next.push(e.from);
				byDepth[depth - 1] = (byDepth[depth - 1] ?? 0) + 1;
				if (symbolPath.has(e.from)) symbols.add(e.from);
				if (path && !own.has(path)) files.add(path);
			}
		}
		frontier = next;
	}
	// Unresolved calls out of the node are open ends too: what they reach is unknown.
	const startSet = new Set(starts);
	for (const e of m.edges)
		if (startSet.has(e.from) && e.resolution === 'unresolved' && e.kind !== 'co_changes')
			unresolved++;

	const components = new Set(
		[...files].map((p) => compOf.get(p)).filter((c) => !!c && !ownComponents.has(c))
	);
	const totalFiles = Math.max(0, deepPaths.size - own.size);
	return {
		files: { affected: files.size, total: totalFiles },
		symbols: { affected: symbols.size, total: symbolPath.size },
		components: {
			affected: components.size,
			total: Math.max(0, m.components.length - ownComponents.size)
		},
		share: totalFiles ? files.size / totalFiles : 0,
		maxDepth: byDepth.length,
		byDepth,
		outside: outside.size,
		ambiguous,
		unresolved,
		lowerBound: unresolved > 0 || outside.size > 0
	};
}

export function impactOf(m: Loaded, id: string, depth: number): Impact {
	const starts = startIds(m, id);
	return computeImpact(
		{ edges: m.edges, symbols: m.symbols, deepPaths: new Set(m.files.map((f) => f.path)) },
		starts,
		{ depth: Math.min(Math.max(depth, 1), 5), maxNodes: 300 }
	);
}

/** Plan §5 Tab 1 "Export as Markdown": the pack with every claim's label and citations. */
export function packMarkdown(p: OnboardingPack, fences: Fence[] = []): string {
	const cite = (c: Citation) =>
		c.kind === 'code'
			? `[${base(c.path)}:${c.start}](https://github.com/${p.repo}/blob/${c.commit}/${c.path}#L${c.start})`
			: `[${c.sha.slice(0, 10)}](https://github.com/${p.repo}/commit/${c.sha})`;
	const claim = (c: Claim) =>
		`- **${c.status.toUpperCase()}${c.confidence ? ` (${c.confidence})` : ''}** ${c.text}${c.citations.length ? ` — ${c.citations.map(cite).join(', ')}` : ''}${c.ask ? ` — ask ${c.ask.name} <${c.ask.email}>` : ''}`;
	const lvl = (l: Level) => (l === 'high' ? '🔴' : l === 'medium' ? '🟠' : '⚪');
	const commit = (c: { sha: string; subject: string; author: string; date: string }) =>
		`${c.author}, ${c.date.slice(0, 10)}: "${c.subject}" (${cite({ kind: 'commit', sha: c.sha })})`;
	const lines = (path: string, start: number, end: number) =>
		`[${base(path)}:${start}–${end}](https://github.com/${p.repo}/blob/${p.commit}/${path}#L${start}-L${end})`;
	return [
		`# ${p.repo}${p.deepScope ? ` / ${p.deepScope}` : ''} — onboarding pack`,
		`Snapshot \`${p.commit}\`. Every statement is labelled Verified / Inferred / Unknown and cites code or commits at this commit.`,
		'',
		'## System at a glance',
		p.architecture.publicHeader
			? `Public interface: \`${base(p.architecture.publicHeader)}\`.`
			: 'No header is included from outside the scope.',
		'',
		`**Used by:** ${p.architecture.usedBy.map((u) => `${u.name} (${u.files})`).join(', ') || 'nothing outside the scope'}.`,
		'',
		`**Made of:** ${p.components.map((c) => `${c.name.replace(/ \+\d+$/, '')} (${c.files.length})`).join(', ')}.`,
		'',
		`**Depends on:** ${p.architecture.dependsOn.map((d) => `${d.name} (${d.files})`).join(', ') || 'nothing outside the scope'}.`,
		'',
		'## What not to break',
		...(fences.length ? [] : ['No line with workaround evidence was found.', '']),
		...fences.flatMap((f) => [
			`### ${f.verdict} if changed: ${f.title}`,
			`\`${f.fn.name}\`, ${lines(f.path, f.start, f.end)}`,
			'',
			f.origin
				? `- **VERIFIED** Why it exists: ${commit(f.origin)}${f.origin.said !== f.origin.subject ? `, which says: "${f.origin.said}"` : ''}`
				: `- **UNKNOWN** No commit says why these lines exist.`,
			f.reverted
				? `- **VERIFIED** Changed before and reverted${f.reverted.days ? ` ${f.reverted.days} days later` : ''}: ${commit(f.reverted.change)}; revert ${commit(f.reverted.revert)}${f.reverted.reason ? `: "${f.reverted.reason}"` : ''}`
				: '',
			f.comment
				? `- **VERIFIED** The comment says: "${f.comment.text}" (${cite({ kind: 'code', commit: p.commit, path: f.path, start: f.comment.line, end: f.comment.line })})`
				: '',
			`- If changed: ${f.because.join('; ')}. ${f.dependents.lowerBound ? 'At least ' : ''}${f.dependents.functions} functions in ${f.dependents.files} files depend on \`${f.fn.name}\`.`,
			...f.alsoIn.map((a) => `- Same origin also in \`${a.fn}\`, ${base(a.path)}:${a.line}`),
			f.ask ? `- Ask: ${f.ask.name} <${f.ask.email}>` : '',
			''
		]),
		'## Hidden couplings',
		...(p.couplings.length ? [] : ['No code outside the scope includes its internal headers.']),
		...p.couplings.map(
			(c) =>
				`- **VERIFIED** \`${base(c.header)}\` belongs to \`${base(c.owner)}\` but is included from outside by ${c.includers.map((i) => `[${i.path}:${i.line}](https://github.com/${p.repo}/blob/${p.commit}/${i.path}#L${i.line})`).join(', ')}`
		),
		'',
		'## Architecture',
		'```mermaid',
		p.mermaid,
		'```',
		'',
		'## Components',
		...p.components.map(
			(c) =>
				`- ${lvl(c.level)} **${c.name}** (${c.files.length} files) — ${c.top.map((t) => `\`${t.name}\``).join(', ') || 'no scored functions'}`
		),
		'',
		'## Critical-parts register',
		...p.critical.flatMap((c) => [
			`### ${lvl(c.level)} \`${c.name}\` — ${base(c.path)}:${c.start}–${c.end} (score ${c.score})`,
			`Why: ${c.factors.map((f) => `${f.factor} +${f.points}`).join(', ')}`,
			...c.claims.map(claim),
			c.ask ? `Ask: ${c.ask.name} <${c.ask.email}>` : '',
			''
		]),
		'## External interfaces',
		...p.interfaces.map(claim),
		'',
		'## Timing and hardware assumptions',
		...p.assumptions.map(claim),
		'',
		'## Open questions / unknowns',
		...p.unknowns.map(claim),
		'',
		'## Where to start reading',
		...p.readingOrder.map((r, i) => `${i + 1}. \`${r.path}\` — ${r.why}`),
		'',
		'## Scope and coverage',
		...p.coverage.notes.map((n) => `- ${n}`)
	].join('\n');
}
