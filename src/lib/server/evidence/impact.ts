// Impact engine shared by Tab 3 (blast radius) and Tab 4 (review): reverse BFS from the start
// nodes over dependency edges. Co-change is correlation, never followed (plan §4.4). Every node
// carries the weakest resolution on its path, and out-of-scope hits are counted, not hidden.

import type { ImpactNode, ReviewResult } from '$lib/review';
import type { EdgeKind, EdgeMethod, EdgeResolution } from '$lib/server/db/scan.schema';

export interface ImpactGraph {
	edges: {
		from: string;
		to: string;
		kind: EdgeKind;
		method: EdgeMethod;
		resolution: EdgeResolution;
	}[];
	symbols: { id: string; name: string; path: string }[];
	/** Files in the deep scope; anything else reached is a boundary node. */
	deepPaths: Set<string>;
}

export type Impact = ReviewResult['impact'];

const RANK = { resolved: 0, ambiguous: 1, unresolved: 2 } as const;
const weaker = (a: EdgeResolution, b: EdgeResolution) => (RANK[a] >= RANK[b] ? a : b);

export function computeImpact(
	graph: ImpactGraph,
	startIds: string[],
	opts: { changedPaths?: string[]; depth?: number; maxNodes?: number } = {}
): Impact {
	const depthLimit = opts.depth ?? 3;
	const maxNodes = opts.maxNodes ?? 150;
	const reverse = new Map<string, ImpactGraph['edges']>();
	for (const e of graph.edges) {
		if (e.kind === 'co_changes') continue;
		const list = reverse.get(e.to) ?? [];
		list.push(e);
		reverse.set(e.to, list);
	}
	const symbols = new Map(graph.symbols.map((s) => [s.id, s]));
	const label = (id: string) => {
		const s = symbols.get(id);
		if (s) return { label: s.name, path: s.path };
		if (id.startsWith('file:')) return { label: id.slice(5).split('/').pop()!, path: id.slice(5) };
		return { label: id, path: null };
	};

	const nodes = new Map<string, ImpactNode>();
	const edges: Impact['edges'] = [];
	const counts = { resolved: 0, ambiguous: 0, unresolved: 0, boundary: 0 };
	const queue: { id: string; depth: number; resolution: EdgeResolution }[] = startIds.map((id) => ({
		id,
		depth: 0,
		resolution: 'resolved'
	}));
	// Changed headers: whoever includes them depends on them too.
	for (const p of opts.changedPaths ?? []) {
		if (/\.(h|hpp|hh)$/.test(p)) queue.push({ id: `file:${p}`, depth: 0, resolution: 'resolved' });
	}
	const seen = new Set(queue.map((q) => q.id));

	// Unresolved calls out of the start nodes are open ends: what they reach is unknown.
	const starts = new Set(startIds);
	for (const e of graph.edges)
		if (starts.has(e.from) && e.resolution === 'unresolved') counts.unresolved++;

	while (queue.length && nodes.size < maxNodes) {
		const cur = queue.shift()!;
		if (cur.depth >= depthLimit) continue;
		for (const e of reverse.get(cur.id) ?? []) {
			const res = weaker(cur.resolution, e.resolution);
			edges.push({ from: e.from, to: cur.id, resolution: e.resolution });
			counts[e.resolution]++;
			if (seen.has(e.from)) continue;
			seen.add(e.from);
			const info = label(e.from);
			const boundary =
				e.method === 'reference_index' || (info.path !== null && !graph.deepPaths.has(info.path));
			if (boundary) counts.boundary++;
			nodes.set(e.from, { id: e.from, ...info, depth: cur.depth + 1, resolution: res, boundary });
			queue.push({ id: e.from, depth: cur.depth + 1, resolution: res });
		}
	}
	return { nodes: [...nodes.values()].sort((a, b) => a.depth - b.depth), edges, counts };
}
