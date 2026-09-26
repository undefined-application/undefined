<script lang="ts">
	// The 3D system graph (docs/ui-spec.md §4.5): 3d-force-graph on three.js. Selecting a node lights
	// up everything that transitively depends on it and fades the rest.
	import type { ForceGraph3DInstance } from '3d-force-graph';
	import type { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
	import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
	import { prefersReducedMotion } from 'svelte/motion';
	import type { GraphData, GraphLevel, GraphNode } from '$lib/model';
	import { cn } from '$lib/utils';
	import {
		PALETTES,
		bloomBackground,
		escapeHtml,
		focusOf,
		linkKey,
		toScene,
		withAlpha,
		type Focus,
		type Palette,
		type SceneLink,
		type SceneNode
	} from './scene';

	interface Props {
		data: GraphData | null;
		selected?: string | null;
		dark?: boolean;
		/** `focus`: component names always, other levels only around the selection. */
		labels?: 'all' | 'focus' | 'none';
		/** Off for decorative use: no clicks, no zoom or pan (rotation still works). */
		interactive?: boolean;
		autoRotate?: boolean;
		/** Canvas colour; defaults to the page background. The canvas is opaque (bloom needs it). */
		background?: string;
		onselect?: (id: string | null) => void;
		/** Double click: drill down one level. */
		ondrill?: (node: GraphNode) => void;
		class?: string;
	}

	let {
		data,
		selected = null,
		dark = false,
		labels = 'focus',
		interactive = true,
		autoRotate = false,
		background,
		onselect,
		ondrill,
		class: className
	}: Props = $props();

	type Instance = ForceGraph3DInstance<SceneNode, SceneLink>;
	type SpriteTextCtor = typeof import('three-spritetext').default;

	let container = $state<HTMLDivElement>();
	let graph = $state.raw<Instance | null>(null);
	let SpriteText: SpriteTextCtor | null = null;
	let bloom: UnrealBloomPass | null = null;
	let output: OutputPass | null = null;
	/** The user has orbited or zoomed: stop framing the graph for them. */
	let moved = false;
	let flownTo: string | null = null;
	/** A decorative graph has been framed: leave the camera to auto-rotate from here. */
	let framed = false;

	const idOf = (end: string | SceneNode) => (typeof end === 'string' ? end : end.id);
	const keyOf = (l: SceneLink) =>
		linkKey(idOf(l.source as string | SceneNode), idOf(l.target as string | SceneNode));

	/** Pull every node gently toward the centre, so unconnected nodes don't drift off and shrink the fit. */
	function gravity(strength: number) {
		let nodes: SceneNode[] = [];
		const force = (alpha: number) => {
			for (const n of nodes) {
				n.vx = (n.vx ?? 0) - (n.x ?? 0) * strength * alpha;
				n.vy = (n.vy ?? 0) - (n.y ?? 0) * strength * alpha;
				n.vz = (n.vz ?? 0) - (n.z ?? 0) * strength * alpha;
			}
		};
		force.initialize = (all: SceneNode[]) => {
			nodes = all;
		};
		return force;
	}

	function linkDistance(level: GraphLevel) {
		return level === 'component' ? 70 : level === 'file' ? 38 : 24;
	}

	function nodeValue(n: SceneNode, level: GraphLevel) {
		if (n.boundary) return 1 + Math.sqrt(n.size) * 0.6;
		if (level === 'component') return 2 + n.size * 0.7;
		if (level === 'file') return 1 + n.size * 0.35;
		return 1 + Math.sqrt(n.size) * 0.9;
	}

	function nodeColor(n: SceneNode, focus: Focus | null, pal: Palette) {
		const base = n.boundary ? pal.boundary : pal.level[n.level];
		if (!focus) return n.boundary ? withAlpha(base, 0.6) : base;
		const f = focus.nodes.get(n.id);
		if (!f) return withAlpha(base, pal.dimAlpha);
		if (f.role === 'self') return pal.self;
		if (f.role === 'dependency') return withAlpha(base, 0.55);
		return withAlpha(base, Math.max(0.6, 1 - (f.depth - 1) * 0.12));
	}

	function linkColor(l: SceneLink, focus: Focus | null, pal: Palette) {
		if (focus) {
			const role = focus.links.get(keyOf(l));
			if (role === 'dependent') return pal.linkLit;
			if (role === 'dependency') return pal.linkDependency;
			return withAlpha('#78716c', 0.05);
		}
		if (l.kind === 'co_changes') return pal.linkCoChange;
		return l.resolution === 'resolved' ? pal.link : pal.linkUncertain;
	}

	function tooltip(n: SceneNode) {
		const kind = n.kind === 'boundary' ? 'outside the analysed scope' : n.kind;
		const signals = n.signals.length
			? `<span>${escapeHtml(n.signals.map((s) => s.replaceAll('_', ' ')).join(', '))}</span>`
			: '';
		const level = n.boundary ? '' : `, ${n.level} criticality`;
		return `<div class="g-tip"><b>${escapeHtml(n.label)}</b><span>${kind}${level}</span>${signals}</div>`;
	}

	function labelFor(n: SceneNode, focus: Focus | null, pal: Palette, level: GraphLevel) {
		if (!SpriteText || labels === 'none') return undefined;
		const f = focus?.nodes.get(n.id);
		const near = f && (f.role === 'self' || f.depth <= 1);
		const show = labels === 'all' || level === 'component' || near;
		if (!show) return undefined;
		// Functions show their short name; the tooltip has the qualified one.
		const text = level === 'symbol' ? n.label.split('::').pop()! : n.label;
		const sprite = new SpriteText(text, level === 'component' ? 6 : 3.6, pal.label);
		sprite.fontFace = "'IBM Plex Sans Variable', 'IBM Plex Sans', sans-serif";
		sprite.fontWeight = '500';
		sprite.backgroundColor = pal.labelBg;
		sprite.padding = [1.8, 0.9];
		sprite.borderRadius = 1.8;
		const faded = focus && !f;
		sprite.material.transparent = true;
		sprite.material.opacity = faded ? 0.18 : 1;
		sprite.material.depthWrite = false;
		sprite.renderOrder = 10;
		sprite.position.y = Math.cbrt(nodeValue(n, level)) * 3.2 + 4;
		return sprite;
	}

	function flyTo(g: Instance, node: SceneNode, level: GraphLevel) {
		if (node.x === undefined || node.y === undefined || node.z === undefined) return;
		const distance = level === 'component' ? 170 : level === 'file' ? 120 : 95;
		const r = Math.hypot(node.x, node.y, node.z) || 1;
		const k = 1 + distance / r;
		g.cameraPosition(
			{ x: node.x * k, y: node.y * k, z: node.z * k },
			{ x: node.x, y: node.y, z: node.z },
			prefersReducedMotion.current ? 0 : 900
		);
	}

	/**
	 * Once the layout settles: frame the lit blast radius if something is selected, else everything.
	 * Decorative graphs always frame everything, and stop once the layout first settles (`settled`):
	 * their selection cycles on a timer and must not move the camera.
	 */
	function frame(g: Instance, settled = false) {
		const d = data;
		if (!interactive) {
			if (framed) return;
			framed = settled;
		}
		const lit =
			interactive && d && selected && d.nodes.some((n) => n.id === selected)
				? focusOf(d, selected).nodes
				: null;
		const ms = prefersReducedMotion.current ? 0 : 700;
		if (lit && lit.size > 2) {
			flownTo = selected;
			g.zoomToFit(ms, 90, (n) => lit.has(n.id));
		} else g.zoomToFit(ms, 48);
	}

	/** Point the camera at a node (search results, links from other pages). */
	export function focusNode(id: string) {
		const g = graph;
		const node = g?.graphData().nodes.find((n) => n.id === id);
		if (g && node && data) flyTo(g, node, data.level);
	}

	/** Frame the whole graph. */
	export function fit() {
		graph?.zoomToFit(prefersReducedMotion.current ? 0 : 600, 48);
	}

	// Create the renderer once. three.js is browser-only and big: load it lazily.
	$effect(() => {
		const el = container;
		if (!el) return;
		let alive = true;
		let instance: Instance | null = null;
		let resize: ResizeObserver | null = null;
		(async () => {
			const [{ default: ForceGraph3D }, sprite, { UnrealBloomPass }, { OutputPass }, three] =
				await Promise.all([
					import('3d-force-graph'),
					import('three-spritetext'),
					import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
					import('three/examples/jsm/postprocessing/OutputPass.js'),
					import('three')
				]);
			if (!alive) return;
			SpriteText = sprite.default;
			const g = (
				new ForceGraph3D(el, {
					controlType: 'orbit',
					rendererConfig: { antialias: true, alpha: false, powerPreference: 'high-performance' }
				}) as unknown as Instance
			)
				.width(el.clientWidth)
				.height(el.clientHeight)
				.showNavInfo(false)
				.nodeRelSize(3.2)
				.nodeResolution(16)
				.nodeOpacity(1)
				.linkOpacity(1)
				.enableNodeDrag(false)
				.warmupTicks(40)
				.cooldownTicks(180)
				.onEngineStop(() => {
					if (!moved) frame(g, true);
				});
			instance = g;
			g.renderer().setPixelRatio(Math.min(window.devicePixelRatio, 2));
			if (interactive) {
				let last = { id: '', at: 0 };
				g.onNodeClick((n) => {
					const now = performance.now();
					if (last.id === n.id && now - last.at < 380) {
						last = { id: '', at: 0 };
						ondrill?.(n);
						return;
					}
					last = { id: n.id, at: now };
					onselect?.(n.id);
				}).onBackgroundClick(() => onselect?.(null));
			} else {
				g.enablePointerInteraction(false);
				const controls = g.controls() as { enableZoom?: boolean; enablePan?: boolean };
				controls.enableZoom = false;
				controls.enablePan = false;
			}
			bloom = new UnrealBloomPass(
				new three.Vector2(el.clientWidth, el.clientHeight),
				0.18,
				0.3,
				0.7
			);
			// Post-processing renders to linear targets; OutputPass converts back to sRGB.
			output = new OutputPass();
			(
				g.controls() as { addEventListener: (type: string, fn: () => void) => void }
			).addEventListener('start', () => (moved = true));
			resize = new ResizeObserver(() => g.width(el.clientWidth).height(el.clientHeight));
			resize.observe(el);
			graph = g;
		})();
		return () => {
			alive = false;
			resize?.disconnect();
			instance?._destructor();
			instance?.renderer().dispose();
			graph = null;
		};
	});

	// New data: relayout and frame it once it settles.
	$effect(() => {
		const g = graph;
		const d = data;
		if (!g || !d) return;
		moved = false;
		flownTo = null;
		framed = false;
		g.graphData(toScene(d));
		const link = g.d3Force('link') as { distance?: (d: number) => unknown } | undefined;
		link?.distance?.(linkDistance(d.level));
		const charge = g.d3Force('charge') as { strength?: (s: number) => unknown } | undefined;
		charge?.strength?.(d.level === 'component' ? -260 : d.level === 'file' ? -90 : -60);
		g.d3Force('gravity', gravity(d.level === 'component' ? 0.06 : 0.035) as never);
		// Frame it while it settles too: the engine-stop event waits on animation frames, which a
		// background tab throttles.
		const timers = [900, 2200].map((ms) => setTimeout(() => !moved && frame(g), ms));
		return () => timers.forEach(clearTimeout);
	});

	// Selection and theme: colours, sizes, labels, bloom.
	$effect(() => {
		const g = graph;
		const d = data;
		if (!g || !d) return;
		const pal = PALETTES[dark ? 'dark' : 'light'];
		const focus = selected && d.nodes.some((n) => n.id === selected) ? focusOf(d, selected) : null;
		const bg = background ?? pal.background;
		g.backgroundColor(dark ? bloomBackground(bg) : bg)
			.nodeVal((n) => nodeValue(n, d.level) * (focus?.nodes.get(n.id)?.role === 'self' ? 1.8 : 1))
			.nodeColor((n) => nodeColor(n, focus, pal))
			.nodeLabel((n) => tooltip(n))
			.linkColor((l) => linkColor(l, focus, pal))
			.linkWidth((l) => {
				const role = focus?.links.get(keyOf(l));
				return role === 'dependent' ? 0.6 : role === 'dependency' ? 0.4 : 0;
			})
			.nodeThreeObjectExtend(true)
			.nodeThreeObject((n) => labelFor(n, focus, pal, d.level) as never);
		const composer = g.postProcessingComposer();
		if (bloom && output) {
			const on = composer.passes.includes(bloom);
			if (dark && !on) {
				composer.addPass(bloom);
				composer.addPass(output);
			} else if (!dark && on) {
				composer.removePass(bloom);
				composer.removePass(output);
			}
		}
	});

	// Fly to a new selection.
	$effect(() => {
		const g = graph;
		const id = selected;
		const d = data;
		if (!g || !d || !id || !interactive || id === flownTo) return;
		const node = g.graphData().nodes.find((n) => n.id === id);
		if (!node || node.x === undefined) return;
		flownTo = id;
		// Frame the whole lit neighbourhood: the blast radius is the point, not the node.
		const lit = focusOf(d, id).nodes;
		if (lit.size > 2) g.zoomToFit(prefersReducedMotion.current ? 0 : 900, 90, (n) => lit.has(n.id));
		else flyTo(g, node, d.level);
	});

	$effect(() => {
		const g = graph;
		if (!g) return;
		const controls = g.controls() as { autoRotate?: boolean; autoRotateSpeed?: number };
		controls.autoRotate = autoRotate && !prefersReducedMotion.current;
		controls.autoRotateSpeed = 0.5;
	});
</script>

<div bind:this={container} class={cn('relative size-full overflow-hidden', className)}></div>
