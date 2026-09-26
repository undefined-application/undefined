// Graph scene helpers shared by the 3D view, the login visual and reviews: colours per theme and
// the neighbourhood a selection lights up (docs/ui-spec.md §4.5).

import type { GraphData, GraphEdge, GraphNode, Level, Resolution } from '$lib/model';

/**
 * A link points the way a change travels: from the code that is depended on to its dependent
 * (`GraphEdge` points the other way, from caller to callee). Particles run along it.
 */
export interface SceneLink {
	source: string;
	target: string;
	kind: string;
	resolution: Resolution;
	weight: number;
}

export type SceneNode = GraphNode & {
	x?: number;
	y?: number;
	z?: number;
	vx?: number;
	vy?: number;
	vz?: number;
};

export function toScene(data: GraphData): { nodes: SceneNode[]; links: SceneLink[] } {
	return {
		nodes: data.nodes.map((n) => ({ ...n })),
		links: data.edges.map((e: GraphEdge) => ({
			source: e.to,
			target: e.from,
			kind: e.kind,
			resolution: e.resolution,
			weight: e.weight
		}))
	};
}

export type Role = 'self' | 'dependent' | 'dependency';

export interface Focus {
	/** Lit nodes: the selection, its transitive dependents (with depth) and its direct dependencies. */
	nodes: Map<string, { role: Role; depth: number }>;
	/** Lit links, keyed `source→target`. */
	links: Map<string, Role>;
}

export const linkKey = (source: string, target: string) => `${source}→${target}`;

/** What lights up when `id` is selected. Co-change is correlation: never part of the radius. */
export function focusOf(data: GraphData, id: string): Focus {
	const nodes: Focus['nodes'] = new Map([[id, { role: 'self', depth: 0 }]]);
	const links: Focus['links'] = new Map();
	const dependents = new Map<string, string[]>();
	for (const e of data.edges) {
		if (e.kind === 'co_changes') continue;
		const list = dependents.get(e.to) ?? [];
		list.push(e.from);
		dependents.set(e.to, list);
	}
	let frontier = [id];
	for (let depth = 1; frontier.length; depth++) {
		const next: string[] = [];
		for (const cur of frontier) {
			for (const dep of dependents.get(cur) ?? []) {
				links.set(linkKey(cur, dep), 'dependent');
				if (nodes.has(dep)) continue;
				nodes.set(dep, { role: 'dependent', depth });
				next.push(dep);
			}
		}
		frontier = next;
	}
	for (const e of data.edges) {
		if (e.kind === 'co_changes' || e.from !== id) continue;
		links.set(linkKey(e.to, e.from), links.get(linkKey(e.to, e.from)) ?? 'dependency');
		if (!nodes.has(e.to)) nodes.set(e.to, { role: 'dependency', depth: 1 });
	}
	return { nodes, links };
}

export interface Palette {
	background: string;
	level: Record<Level, string>;
	boundary: string;
	self: string;
	label: string;
	labelBg: string;
	link: string;
	linkUncertain: string;
	linkCoChange: string;
	linkLit: string;
	linkDependency: string;
	dimAlpha: number;
}

/** Selected per mode, not flipped (dataviz: dark mode gets its own steps). */
export const PALETTES: Record<'light' | 'dark', Palette> = {
	dark: {
		background: '#0c0a09',
		level: { high: '#f87171', medium: '#fbbf24', low: '#a8a29e' },
		boundary: '#57534e',
		self: '#e7e5e4',
		label: '#f5f5f4',
		labelBg: 'rgba(12,10,9,0.72)',
		link: 'rgba(168,162,158,0.28)',
		linkUncertain: 'rgba(217,119,6,0.32)',
		linkCoChange: 'rgba(167,139,250,0.35)',
		linkLit: 'rgba(214,211,209,0.5)',
		linkDependency: 'rgba(168,162,158,0.3)',
		dimAlpha: 0.08
	},
	light: {
		background: '#fcfcfb',
		level: { high: '#dc2626', medium: '#d97706', low: '#78716c' },
		boundary: '#d6d3d1',
		self: '#1c1917',
		label: '#1c1917',
		labelBg: 'rgba(255,255,255,0.82)',
		link: 'rgba(120,113,108,0.3)',
		linkUncertain: 'rgba(217,119,6,0.4)',
		linkCoChange: 'rgba(124,58,237,0.35)',
		linkLit: 'rgba(41,37,36,0.6)',
		linkDependency: 'rgba(87,83,78,0.5)',
		dimAlpha: 0.1
	}
};

/** `#rrggbb` + alpha → `rgba()`. */
export function withAlpha(hex: string, alpha: number): string {
	const n = parseInt(hex.slice(1), 16);
	return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export const escapeHtml = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
	);

/**
 * With bloom the scene renders into a linear target, three writes the clear colour into it
 * sRGB-encoded, and OutputPass encodes it again. Decode it once more up front so the canvas lands on
 * `hex` (to the nearest 1/255 step).
 */
export function bloomBackground(hex: string): string {
	const n = parseInt(hex.slice(1), 16);
	const linear = (c: number) => {
		const v = c / 255;
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(linear(c) * 255));
	return `rgb(${rgb.join(',')})`;
}
