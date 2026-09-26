<script lang="ts">
	// Login visual: the product's core moment rendered for real on a generated system. Every few
	// seconds one function lights up everything that depends on it. Static under reduced motion.
	import { mode } from 'mode-watcher';
	import { prefersReducedMotion } from 'svelte/motion';
	import type { GraphData, GraphNode, Level } from '$lib/model';
	import Graph3D from './Graph3D.svelte';

	/** Seeded, so the picture is the same on every visit. */
	function random(seed: number) {
		return () => {
			seed = (seed * 1664525 + 1013904223) % 4294967296;
			return seed / 4294967296;
		};
	}

	function generate(): { data: GraphData; hubs: string[] } {
		const r = random(11);
		const nodes: GraphNode[] = [];
		const edges: GraphData['edges'] = [];
		const clusters: string[][] = [];
		for (let c = 0; c < 7; c++) {
			const ids: string[] = [];
			const count = 10 + Math.floor(r() * 14);
			for (let i = 0; i < count; i++) {
				const id = `n${c}.${i}`;
				const x = r();
				const level: Level = x > 0.9 ? 'high' : x > 0.72 ? 'medium' : 'low';
				nodes.push({
					id,
					label: id,
					kind: 'function',
					path: null,
					component: `c${c}`,
					level,
					score: 0,
					signals: [],
					boundary: false,
					size: 1 + Math.floor(r() * 5)
				});
				// Callers point at earlier functions of the same component: a layered, acyclic core.
				if (i > 0) {
					const calls = 1 + Math.floor(r() * 2);
					for (let k = 0; k < calls; k++) {
						const to = ids[Math.floor(r() * ids.length)];
						edges.push({ from: id, to, kind: 'calls', resolution: 'resolved', weight: 1 });
					}
				}
				ids.push(id);
			}
			clusters.push(ids);
		}
		// A few components reach into the core of others.
		for (let c = 1; c < clusters.length; c++) {
			for (let k = 0; k < 4; k++) {
				const from = clusters[c][Math.floor(r() * clusters[c].length)];
				const other = clusters[Math.floor(r() * c)];
				edges.push({
					from,
					to: other[Math.floor(r() * Math.min(4, other.length))],
					kind: 'calls',
					resolution: r() > 0.8 ? 'ambiguous' : 'resolved',
					weight: 1
				});
			}
		}
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to generate(), not state
		const fanIn = new Map<string, number>();
		for (const e of edges) fanIn.set(e.to, (fanIn.get(e.to) ?? 0) + 1);
		const hubs = [...fanIn]
			.filter(([, n]) => n >= 3)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8)
			.map(([id]) => id);
		return { data: { level: 'symbol', nodes, edges, truncated: false }, hubs };
	}

	const { data, hubs } = generate();
	let selected = $state<string | null>(hubs[0] ?? null);

	$effect(() => {
		if (prefersReducedMotion.current || hubs.length < 2) return;
		let i = 0;
		const timer = setInterval(() => {
			i = (i + 1) % hubs.length;
			selected = hubs[i];
		}, 3600);
		return () => clearInterval(timer);
	});
</script>

<Graph3D
	{data}
	{selected}
	dark={mode.current === 'dark'}
	background={mode.current === 'dark' ? '#0c0a09' : '#f4f3f1'}
	labels="none"
	interactive={false}
	autoRotate
/>
