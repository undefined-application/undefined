// Stage 4: componentization (plan §4.2). Small scopes: directory structure only. Larger scopes:
// directories plus Louvain community detection on resolved edges, seeded so reruns agree.

import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { yielder } from '$lib/server/jobs/yield';
import type { EdgeRow } from './structure';

export interface ComponentRow {
	id: string;
	name: string;
	files: string[];
}

const SMALL_SCOPE = 30;

const dirname = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
/** `file:<path>` / `sym:<path>#<name>` → path; other node kinds → null. */
const fileOfNode = (node: string) =>
	node.startsWith('file:')
		? node.slice(5)
		: node.startsWith('sym:')
			? node.slice(4, node.indexOf('#'))
			: null;
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

/** Deterministic PRNG so Louvain gives the same components for the same snapshot. */
function mulberry32(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Longest shared `_`-separated prefix of base names (without extension). */
function sharedPrefix(files: string[]): string[] {
	const parts = files.map((f) => basename(f).split('_'));
	const prefix: string[] = [];
	for (let i = 0; ; i++) {
		const p = parts[0]?.[i];
		if (p === undefined || !parts.every((x) => x[i] === p)) break;
		prefix.push(p);
	}
	return prefix;
}

/** Length (in `_` segments) of the longest name prefix shared by at least 60% of the files. */
function majorityPrefix(files: string[]): number {
	const parts = files.map((f) => basename(f).split('_'));
	let len = 0;
	for (;;) {
		const counts = new Map<string, number>();
		for (const p of parts) {
			if (p.length <= len) continue;
			const key = p.slice(0, len + 1).join('_');
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		const best = Math.max(0, ...counts.values());
		// `best === 0`: no name has this many segments (always true for an empty list).
		if (best === 0 || best < files.length * 0.6) return len;
		len++;
	}
}

/**
 * A readable name: the members' shared name prefix when it says more than the prefix every
 * file in the scope shares (e.g. `AP_InertialSensor_Invensense`), else the hub file's name.
 */
function nameFor(
	files: string[],
	deepScope: string,
	scopePrefix: number,
	degree: Map<string, number>
) {
	if (files.length === 1) return basename(files[0]);
	const prefix = sharedPrefix(files);
	if (prefix.length > scopePrefix) return prefix.join('_');
	const dirs = [...new Set(files.map(dirname))];
	const dir = dirs.length === 1 ? dirs[0].slice(deepScope.length).replace(/^\//, '') : '';
	const hub = [...files].sort(
		(a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b)
	)[0];
	return `${basename(hub)}${dir ? ` (${dir})` : ''} +${files.length - 1}`;
}

export async function buildComponents(
	deepScope: string,
	files: string[],
	edges: EdgeRow[]
): Promise<ComponentRow[]> {
	if (files.length === 0) return [];
	const tick = yielder();
	const byDir = new Map<string, string[]>();
	for (const f of files) {
		const d = dirname(f);
		const list = byDir.get(d);
		if (list) list.push(f);
		else byDir.set(d, [f]);
	}

	// One pass over the edges: file-level resolved dependencies inside the deep scope, grouped by
	// directory (Louvain runs per directory), plus each file's weighted degree (names the groups).
	const inScope = new Set(files);
	const sameDir = new Map<string, { a: string; b: string; weight: number }[]>();
	const degree = new Map<string, number>();
	for (const e of edges) {
		if (e.resolution !== 'resolved' || e.kind === 'co_changes' || e.method === 'reference_index')
			continue;
		const a = fileOfNode(e.from);
		const b = fileOfNode(e.to);
		for (const n of [a, b]) if (n) degree.set(n, (degree.get(n) ?? 0) + e.weight);
		if (!a || !b || a === b || !inScope.has(a) || !inScope.has(b)) continue;
		const dir = dirname(a);
		if (dirname(b) !== dir) continue;
		const list = sameDir.get(dir) ?? [];
		list.push({ a, b, weight: e.weight });
		sameDir.set(dir, list);
	}

	const groups: string[][] = [];
	if (files.length < SMALL_SCOPE) {
		groups.push(...byDir.values());
	} else {
		for (const [dir, members] of byDir) {
			await tick();
			const g = new Graph({ type: 'undirected' });
			for (const f of members) g.addNode(f);
			for (const { a, b, weight } of sameDir.get(dir) ?? []) {
				if (g.hasEdge(a, b)) g.updateEdgeAttribute(a, b, 'weight', (w: number) => w + weight);
				else g.addEdge(a, b, { weight });
			}
			if (g.size === 0 || members.length < 4) {
				groups.push(members);
				continue;
			}
			const communities = louvain(g, { getEdgeWeight: 'weight', rng: mulberry32(42) });
			const byCommunity = new Map<number, string[]>();
			for (const f of members) {
				const c = communities[f];
				const list = byCommunity.get(c);
				if (list) list.push(f);
				else byCommunity.set(c, [f]);
			}
			groups.push(...byCommunity.values());
		}
	}

	// The naming prefix most of the scope shares (e.g. `AP_InertialSensor`) says nothing about a group.
	const scopePrefix = majorityPrefix(files);

	const used = new Set<string>();
	return groups
		.map((g) => g.sort())
		.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]))
		.map((members) => {
			const base = nameFor(members, deepScope, scopePrefix, degree);
			let name = base;
			for (let n = 2; used.has(name); n++) name = `${base} #${n}`;
			used.add(name);
			return { id: `comp:${name}`, name, files: members };
		});
}
