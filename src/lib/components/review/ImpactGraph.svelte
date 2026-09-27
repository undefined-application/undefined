<script lang="ts">
	// The review's blast radius as a small 3D graph: the PR, the code it touches, and everything
	// that depends on that. Selecting the PR lights up the whole radius.
	import { mode } from 'mode-watcher';
	import Graph3D from '$lib/components/graph/Graph3D.svelte';
	import type { GraphData, GraphNode } from '$lib/model';
	import type { ReviewResult } from '$lib/review';

	interface Props {
		result: ReviewResult;
		number: number;
	}

	let { result, number }: Props = $props();

	const data = $derived.by((): GraphData => {
		const pr = `pr:${number}`;
		const node = (n: Partial<GraphNode> & { id: string; label: string }): GraphNode => ({
			kind: 'function',
			path: null,
			component: null,
			level: 'low',
			score: 0,
			signals: [],
			boundary: false,
			size: 1,
			...n
		});
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built once per derivation
		const nodes = new Map<string, GraphNode>([
			[pr, node({ id: pr, label: `#${number}`, level: 'high', size: 6 })]
		]);
		for (const t of result.touched)
			nodes.set(t.id, node({ id: t.id, label: t.name, level: t.level, path: t.path, size: 3 }));
		for (const n of result.impact.nodes)
			if (!nodes.has(n.id))
				nodes.set(n.id, node({ id: n.id, label: n.label, path: n.path, boundary: n.boundary }));
		const edges: GraphData['edges'] = result.touched.map((t) => ({
			from: t.id,
			to: pr,
			kind: 'calls',
			resolution: 'resolved',
			weight: 1
		}));
		for (const e of result.impact.edges)
			if (nodes.has(e.from) && nodes.has(e.to)) edges.push({ ...e, kind: 'calls', weight: 1 });
		return { level: 'symbol', nodes: [...nodes.values()], edges, truncated: false };
	});
</script>

<div class="h-72 overflow-hidden rounded-lg ring-1 ring-border">
	<Graph3D
		{data}
		selected="pr:{number}"
		dark={mode.current === 'dark'}
		background={mode.current === 'dark' ? '#161312' : '#ffffff'}
		labels="focus"
		padding={{ lit: 12, all: 12 }}
	/>
</div>
