// Stage 1: symbols + edges over the deep scope, and the cheap reference index over the
// reference scope (plan §4.2, §4.5.1–2). Every edge carries how it was found and how sure it is.

import type { EdgeKind, EdgeMethod, EdgeResolution } from '$lib/server/db/scan.schema';
import { yielder } from '$lib/server/jobs/yield';
import { lineOf, parseC, type CSymbol, type Parsed } from './cparse';

export const SOURCE_LANGUAGES = new Set(['c', 'c-header', 'cpp', 'cpp-header']);

export interface SourceFile {
	path: string;
	text: string;
}

export interface SymbolRow extends CSymbol {
	id: string;
	path: string;
	/** Call sites to names defined nowhere in the deep scope (libraries, HAL, std). */
	externalCalls: number;
}

export interface EdgeRow {
	from: string;
	to: string;
	kind: EdgeKind;
	method: EdgeMethod;
	resolution: EdgeResolution;
	weight: number;
	candidates?: string[];
	evidence: { path: string; line: number };
}

export interface FileParse {
	path: string;
	lines: number;
	parsed: boolean;
	unbalanced: boolean;
	error: string | null;
}

export interface Structure {
	symbols: SymbolRow[];
	edges: EdgeRow[];
	files: FileParse[];
	parsed: Map<string, Parsed>;
	/** Files outside the deep scope that reference it (boundary nodes). */
	boundary: string[];
}

export const fileId = (path: string) => `file:${path}`;

const dirname = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));

function normalizePath(p: string): string {
	const out: string[] = [];
	for (const part of p.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') out.pop();
		else out.push(part);
	}
	return out.join('/');
}

/** Resolve an `#include` against the repo's file list. */
export function resolveInclude(
	from: string,
	inc: string,
	allPaths: Set<string>,
	bySuffix: Map<string, string[]>
): { resolution: EdgeResolution; targets: string[] } {
	for (const direct of [normalizePath(`${dirname(from)}/${inc}`), `libraries/${inc}`, inc]) {
		if (allPaths.has(direct)) return { resolution: 'resolved', targets: [direct] };
	}
	const base = inc.slice(inc.lastIndexOf('/') + 1);
	const matches = (bySuffix.get(base) ?? []).filter((p) => p === inc || p.endsWith(`/${inc}`));
	if (matches.length === 1) return { resolution: 'resolved', targets: matches };
	if (matches.length > 1) return { resolution: 'ambiguous', targets: matches };
	return { resolution: 'unresolved', targets: [] };
}

/** Generic method names: a bare mention outside the scope says nothing about which class. */
const GENERIC_NAMES = new Set(
	'init update start stop read write reset begin end get set run loop setup enable disable available healthy handle process check clear flush open close send receive name type value data size count length'.split(
		' '
	)
);

export async function buildStructure(input: {
	deep: SourceFile[];
	/** Reference-scope source files outside the deep scope. */
	reference: SourceFile[];
	/** Every path in the repo at the snapshot (for include resolution). */
	allPaths: string[];
}): Promise<Structure> {
	// Thousands of files: yield between them so the server keeps answering (see jobs/yield).
	const tick = yielder();
	const allPaths = new Set(input.allPaths);
	const bySuffix = new Map<string, string[]>();
	for (const p of input.allPaths) {
		const base = p.slice(p.lastIndexOf('/') + 1);
		const list = bySuffix.get(base);
		if (list) list.push(p);
		else bySuffix.set(base, [p]);
	}

	const parsed = new Map<string, Parsed>();
	const files: FileParse[] = [];
	const symbols: SymbolRow[] = [];
	const idsUsed = new Set<string>();

	for (const f of input.deep) {
		await tick();
		try {
			const p = parseC(f.text);
			parsed.set(f.path, p);
			files.push({
				path: f.path,
				lines: p.blanked.lines,
				parsed: true,
				unbalanced: p.unbalanced,
				error: null
			});
			for (const s of p.symbols) {
				let id = `sym:${f.path}#${s.name}`;
				for (let n = 2; idsUsed.has(id); n++) id = `sym:${f.path}#${s.name}~${n}`;
				idsUsed.add(id);
				symbols.push({ ...s, id, path: f.path, externalCalls: 0 });
			}
		} catch (err) {
			files.push({
				path: f.path,
				lines: f.text.split('\n').length,
				parsed: false,
				unbalanced: false,
				error: (err as Error).message
			});
		}
	}

	// Symbol lookup: per file, symbols in parse order, so call `from` indexes map back.
	const byFile = new Map<string, SymbolRow[]>();
	for (const s of symbols) {
		const list = byFile.get(s.path);
		if (list) list.push(s);
		else byFile.set(s.path, [s]);
	}
	const functionsByShort = new Map<string, SymbolRow[]>();
	const functionsByName = new Map<string, SymbolRow[]>();
	const macrosByName = new Map<string, SymbolRow[]>();
	const push = (m: Map<string, SymbolRow[]>, k: string, s: SymbolRow) => {
		const list = m.get(k);
		if (list) list.push(s);
		else m.set(k, [s]);
	};
	for (const s of symbols) {
		if (s.kind === 'function') {
			push(functionsByShort, s.shortName, s);
			push(functionsByName, s.name, s);
		} else if (s.kind === 'macro') push(macrosByName, s.name, s);
	}

	const edges = new Map<string, EdgeRow>();
	const addEdge = (e: Omit<EdgeRow, 'weight'>) => {
		const key = `${e.from}\0${e.to}\0${e.kind}`;
		const existing = edges.get(key);
		if (existing) existing.weight++;
		else edges.set(key, { ...e, weight: 1 });
	};
	const unique = (list: SymbolRow[]) => [...new Map(list.map((s) => [s.name, s])).values()];

	for (const [path, p] of parsed) {
		await tick();
		const fileSymbols = byFile.get(path) ?? [];
		const bySymbolIndex = (i: number) => fileSymbols[i];

		for (const call of p.calls) {
			const caller = bySymbolIndex(call.from);
			if (!caller) continue;
			let candidates: SymbolRow[];
			let resolvedByContext = false;
			if (call.qualifier) {
				candidates = unique(
					(functionsByShort.get(call.name) ?? []).filter(
						(s) => s.className === call.qualifier || s.className?.endsWith(`::${call.qualifier}`)
					)
				);
				resolvedByContext = true;
			} else if (!call.member) {
				const own = caller.className
					? functionsByName.get(`${caller.className}::${call.name}`)
					: undefined;
				if (own?.length) {
					candidates = unique(own);
					resolvedByContext = true;
				} else {
					const free = (functionsByShort.get(call.name) ?? []).filter((s) => !s.className);
					candidates = unique(free.length ? free : (functionsByShort.get(call.name) ?? []));
					resolvedByContext = free.length > 0;
				}
			} else {
				// obj->name(): receiver type unknown, so even one candidate is only a guess.
				candidates = unique(functionsByShort.get(call.name) ?? []);
			}
			if (candidates.length === 0) {
				caller.externalCalls++;
				continue;
			}
			const evidence = { path, line: call.line };
			// One candidate for a plain call: own class, a free function, or an inherited base method.
			if (candidates.length === 1 && (resolvedByContext || !call.member)) {
				addEdge({
					from: caller.id,
					to: candidates[0].id,
					kind: 'calls',
					method: 'name_match',
					resolution: 'resolved',
					evidence
				});
			} else {
				addEdge({
					from: caller.id,
					to: candidates[0].id,
					kind: 'calls',
					method: 'name_match',
					resolution: 'ambiguous',
					candidates: candidates.map((c) => c.id),
					evidence
				});
			}
		}

		for (const ind of p.indirectCalls) {
			const caller = bySymbolIndex(ind.from);
			if (!caller) continue;
			addEdge({
				from: caller.id,
				to: `open:${caller.id}:${ind.line}`,
				kind: 'calls',
				method: 'name_match',
				resolution: 'unresolved',
				evidence: { path, line: ind.line }
			});
		}

		// Macro uses inside function bodies.
		if (macrosByName.size > 0) {
			const { code, lineStarts } = p.blanked;
			for (const fn of fileSymbols.filter((s) => s.kind === 'function')) {
				const from = lineStarts[fn.start - 1];
				const text = code.slice(
					from,
					fn.end < lineStarts.length ? lineStarts[fn.end] : code.length
				);
				const seen = new Set<string>();
				for (const m of text.matchAll(/\b[A-Za-z_]\w*\b/g)) {
					const defs = macrosByName.get(m[0]);
					if (!defs || seen.has(m[0])) continue;
					seen.add(m[0]);
					const line = lineOf(lineStarts, from + m.index!);
					addEdge({
						from: fn.id,
						to: defs[0].id,
						kind: 'uses_macro',
						method: 'name_match',
						resolution: defs.length === 1 ? 'resolved' : 'ambiguous',
						candidates: defs.length > 1 ? defs.map((d) => d.id) : undefined,
						evidence: { path, line }
					});
				}
			}
		}

		for (const inc of p.includes) {
			const r = resolveInclude(path, inc.path, allPaths, bySuffix);
			if (r.resolution === 'unresolved') {
				// `<stdint.h>` etc. are outside the repo by design; a missing `"x.h"` is an open end.
				if (!inc.system) {
					addEdge({
						from: fileId(path),
						to: `open:include:${inc.path}`,
						kind: 'includes',
						method: 'include_path',
						resolution: 'unresolved',
						evidence: { path, line: inc.line }
					});
				}
				continue;
			}
			addEdge({
				from: fileId(path),
				to: fileId(r.targets[0]),
				kind: 'includes',
				method: 'include_path',
				resolution: r.resolution,
				candidates: r.resolution === 'ambiguous' ? r.targets.map(fileId) : undefined,
				evidence: { path, line: inc.line }
			});
		}
	}

	// Reference index: who outside the deep scope includes or names deep-scope things.
	const outside: { path: string; p: Parsed }[] = [];
	for (const f of input.reference) {
		await tick();
		try {
			outside.push({ path: f.path, p: parseC(f.text) });
		} catch {
			// Unparseable outside file: it just doesn't contribute references.
		}
	}
	// A name also defined outside the deep scope (`get_singleton`, `init`, a `PACKED` struct…)
	// can't tell us who uses *our* definition, so it isn't indexed at all.
	const definedOutside = new Set(outside.flatMap(({ p }) => p.symbols.map((s) => s.shortName)));
	const deepPaths = new Set(parsed.keys());
	const indexed = new Map<string, SymbolRow[]>();
	for (const s of symbols) {
		const generic = GENERIC_NAMES.has(s.shortName) || s.shortName.length < 5;
		if (s.kind === 'function' && s.className && generic) continue;
		if (s.kind === 'macro' && s.name.length < 5) continue;
		if (definedOutside.has(s.shortName)) continue;
		push(indexed, s.shortName, s);
	}
	const boundary = new Set<string>();
	for (const f of outside) {
		await tick();
		const { p } = f;
		for (const inc of p.includes) {
			const r = resolveInclude(f.path, inc.path, allPaths, bySuffix);
			const hits = r.targets.filter((t) => deepPaths.has(t));
			if (hits.length === 0) continue;
			boundary.add(f.path);
			addEdge({
				from: fileId(f.path),
				to: fileId(hits[0]),
				kind: 'includes',
				method: 'reference_index',
				resolution: r.resolution,
				candidates: r.resolution === 'ambiguous' ? r.targets.map(fileId) : undefined,
				evidence: { path: f.path, line: inc.line }
			});
		}
		const { code, lineStarts } = p.blanked;
		const seen = new Set<string>();
		for (const m of code.matchAll(/\b[A-Za-z_]\w*\b/g)) {
			const name = m[0];
			if (seen.has(name)) continue;
			const defs = indexed.get(name);
			if (!defs) continue;
			seen.add(name);
			const targets = unique(defs);
			// A method named without its object: which class is meant is a guess.
			const isMethod = targets.every((t) => t.kind === 'function' && t.className);
			boundary.add(f.path);
			addEdge({
				from: fileId(f.path),
				to: targets[0].id,
				kind:
					targets[0].kind === 'macro'
						? 'uses_macro'
						: targets[0].kind === 'class'
							? 'references'
							: 'calls',
				method: 'reference_index',
				resolution: targets.length === 1 && !isMethod ? 'resolved' : 'ambiguous',
				candidates: targets.length > 1 || isMethod ? targets.map((t) => t.id) : undefined,
				evidence: { path: f.path, line: lineOf(lineStarts, m.index!) }
			});
		}
	}

	return { symbols, edges: [...edges.values()], files, parsed, boundary: [...boundary].sort() };
}
