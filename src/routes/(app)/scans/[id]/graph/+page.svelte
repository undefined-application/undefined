<script lang="ts">
	import { apiFetch } from '$lib/api';
	import BoxesIcon from '@lucide/svelte/icons/boxes';
	import BracesIcon from '@lucide/svelte/icons/braces';
	import FileCodeIcon from '@lucide/svelte/icons/file-code';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import LocateFixedIcon from '@lucide/svelte/icons/locate-fixed';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import Minimize2Icon from '@lucide/svelte/icons/minimize-2';
	import ScanIcon from '@lucide/svelte/icons/scan';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import { mode } from 'mode-watcher';
	import { page } from '$app/state';
	import { threadFor } from '$lib/components/chat/thread.svelte';
	import Graph3D from '$lib/components/graph/Graph3D.svelte';
	import NodeInspector from '$lib/components/graph/NodeInspector.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import { basename, num } from '$lib/format';
	import type { GraphData, GraphLevel, GraphNode, NodeDetails, Reach } from '$lib/model';
	import type { ReviewResult } from '$lib/review';
	import { cn } from '$lib/utils';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const scan = $derived(data.scan);

	type Impact = ReviewResult['impact'];

	// Deep links from the wiki: ?level=symbol&file=<path>&focus=<node id>
	const params = page.url.searchParams;
	const initialLevel = params.get('level');
	let level = $state<GraphLevel>(
		initialLevel === 'file' || initialLevel === 'symbol' ? initialLevel : 'component'
	);
	let file = $state<string | null>(params.get('file'));
	let selected = $state<string | null>(params.get('focus'));
	let showCoChange = $state(false);
	let depth = $state(3);
	let query = $state('');
	let searchOpen = $state(false);
	/** Keyboard-highlighted search result (arrow keys). */
	let active = $state(0);
	let graphView = $state<ReturnType<typeof Graph3D>>();

	let graphData = $state.raw<GraphData | null>(null);
	let graphError = $state('');
	let loading = $state(false);

	async function getJson<T>(url: string): Promise<T> {
		const res = await apiFetch(url);
		const body = await res.json().catch(() => null);
		if (!res.ok) throw new Error(body?.message ?? res.statusText);
		return body as T;
	}

	$effect(() => {
		if (scan.status !== 'done') return;
		const q = new URLSearchParams({
			level,
			cochange: showCoChange ? '1' : '0',
			...(file && level === 'symbol' ? { file } : {})
		});
		let current = true;
		loading = true;
		graphError = '';
		getJson<GraphData>(`/api/scans/${scan.id}/graph?${q}`)
			.then((d) => {
				if (current) graphData = d;
			})
			.catch((e: Error) => {
				if (current) graphError = e.message;
			})
			.finally(() => {
				if (current) loading = false;
			});
		return () => {
			current = false;
		};
	});

	const details = $derived(
		selected && graphData?.nodes.some((n) => n.id === selected && !n.boundary)
			? getJson<{ details: NodeDetails; reach: Reach; impact: Impact | null }>(
					`/api/scans/${scan.id}/node?${new URLSearchParams({ id: selected, impact: String(depth) })}`
				)
			: null
	);

	const levels = [
		{ value: 'component', label: 'Components', icon: BoxesIcon },
		{ value: 'file', label: 'Files', icon: FileCodeIcon },
		{ value: 'symbol', label: 'Functions', icon: BracesIcon }
	] as const;

	function setLevel(next: string) {
		if (!next || next === level) return;
		level = next as GraphLevel;
		if (level !== 'symbol') file = null;
		selected = null;
	}

	function drill(node: GraphNode) {
		if (node.kind === 'component') {
			level = 'file';
			selected = null;
		} else if (node.kind === 'file' && node.path) {
			file = node.path;
			level = 'symbol';
			selected = null;
		}
	}

	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q || !graphData) return [];
		return graphData.nodes.filter((n) => n.label.toLowerCase().includes(q)).slice(0, 8);
	});

	function pick(id: string) {
		if (graphData?.nodes.some((n) => n.id === id)) {
			selected = id;
			graphView?.focusNode(id);
		}
		query = '';
		searchOpen = false;
		active = 0;
	}

	function onSearchKey(e: KeyboardEvent) {
		const open = searchOpen && matches.length > 0;
		if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && open) {
			e.preventDefault();
			const step = e.key === 'ArrowDown' ? 1 : -1;
			active = (active + step + matches.length) % matches.length;
			document.getElementById(`graph-search-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
		} else if (e.key === 'Enter' && open) {
			e.preventDefault();
			pick(matches[Math.min(active, matches.length - 1)].id);
		} else if (e.key === 'Escape') {
			(e.currentTarget as HTMLInputElement).blur();
		}
	}

	function ask(question: string) {
		threadFor(scan.id).send(question);
	}

	const counts = $derived(
		graphData
			? {
					nodes: graphData.nodes.length,
					edges: graphData.edges.length,
					truncated: graphData.truncated
				}
			: null
	);

	// Full screen is the browser's (Fullscreen API) on the graph surface; the chat dock stays behind.
	let surface = $state<HTMLDivElement>();
	let fullscreen = $state(false);

	function toggleFullscreen() {
		if (document.fullscreenElement) document.exitFullscreen();
		else surface?.requestFullscreen().catch(() => {});
	}
</script>

<svelte:document
	onfullscreenchange={() => {
		fullscreen = document.fullscreenElement === surface;
		setTimeout(() => graphView?.fit(), 150);
	}}
/>

<svelte:head><title>Graph · {scan.repo}</title></svelte:head>

<div
	bind:this={surface}
	class="relative h-[calc(100dvh-3rem)] overflow-hidden bg-background [&:fullscreen]:h-dvh"
>
	{#if scan.status !== 'done'}
		<div class="grid h-full place-content-center gap-2 text-center">
			<ScanIcon class="mx-auto size-6 text-muted-foreground" />
			<p class="text-sm">The graph appears when the scan finishes.</p>
		</div>
	{:else}
		<Graph3D
			bind:this={graphView}
			data={graphData}
			{selected}
			dark={mode.current === 'dark'}
			onselect={(id) => (selected = id)}
			ondrill={drill}
		/>

		<!-- Controls, and the legend under them: one column, so the legend moves down when the controls
			 wrap on a narrow page instead of covering them. They stay clear of the open inspector. -->
		<div
			class={cn(
				'pointer-events-none absolute top-3 left-3 flex flex-col items-start gap-2',
				details ? 'right-3 md:right-[calc(22rem+1.5rem)]' : 'right-3'
			)}
		>
			<div class="flex flex-wrap items-start gap-2">
				<div
					class="pointer-events-auto flex items-center gap-1 rounded-lg glass-card p-1 shadow-sm ring-1 ring-foreground/10"
				>
					<ToggleGroup.Root type="single" spacing={0.5} value={level} onValueChange={setLevel}>
						{#each levels as l (l.value)}
							<ToggleGroup.Item value={l.value} class="h-7 gap-1.5 rounded-sm px-2.5 text-xs">
								<l.icon class="size-3.5" />
								{l.label}
							</ToggleGroup.Item>
						{/each}
					</ToggleGroup.Root>
				</div>

				{#if file && level === 'symbol'}
					<div
						class="pointer-events-auto flex h-9 items-center gap-1.5 rounded-lg glass-card pr-1 pl-2.5 text-xs shadow-sm ring-1 ring-foreground/10"
					>
						<FileCodeIcon class="size-3.5 text-muted-foreground" />
						<span class="max-w-48 truncate">{basename(file)}</span>
						<Button
							variant="ghost"
							size="icon-xs"
							onclick={() => (file = null)}
							aria-label="Show all functions"
						>
							<XIcon />
						</Button>
					</div>
				{/if}

				<div class="pointer-events-auto relative">
					<div
						class="flex h-9 w-56 items-center gap-2 rounded-lg glass-card px-2.5 shadow-sm ring-1 ring-foreground/10"
					>
						<SearchIcon class="size-3.5 shrink-0 text-muted-foreground" />
						<input
							bind:value={query}
							placeholder="Find a node"
							aria-label="Find a node"
							autocomplete="off"
							class="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
							role="combobox"
							aria-autocomplete="list"
							aria-expanded={searchOpen && matches.length > 0}
							aria-controls="graph-search-list"
							aria-activedescendant={searchOpen && matches.length
								? `graph-search-opt-${active}`
								: undefined}
							onfocus={() => (searchOpen = true)}
							onblur={() => setTimeout(() => (searchOpen = false), 120)}
							oninput={() => {
								searchOpen = true;
								active = 0;
							}}
							onkeydown={onSearchKey}
						/>
					</div>
					{#if searchOpen && matches.length}
						<ul
							id="graph-search-list"
							role="listbox"
							aria-label="Matching nodes"
							class="absolute top-full left-0 z-10 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg bg-popover p-1 shadow-lg ring-1 ring-foreground/10"
						>
							{#each matches as n, i (n.id)}
								<!-- Keyboard lives on the combobox input (aria-activedescendant). -->
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<li
									id="graph-search-opt-{i}"
									role="option"
									aria-selected={i === active}
									class={cn(
										'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
										i === active && 'bg-accent text-accent-foreground'
									)}
									onmousedown={(e) => e.preventDefault()}
									onmousemove={() => (active = i)}
									onclick={() => pick(n.id)}
								>
									<span class="min-w-0 flex-1 truncate">{n.label}</span>
									<span class="text-[10.5px] text-muted-foreground">{n.level}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<label
					class="pointer-events-auto flex h-9 items-center gap-2 rounded-lg glass-card px-2.5 text-xs shadow-sm ring-1 ring-foreground/10"
				>
					<Switch bind:checked={showCoChange} size="sm" />
					Changed together
				</label>

				<div
					class="pointer-events-auto flex h-9 items-center gap-0.5 rounded-lg glass-card p-1 shadow-sm ring-1 ring-foreground/10"
				>
					<Button
						variant="ghost"
						size="icon-sm"
						class="size-7 rounded-sm"
						onclick={() => graphView?.fit()}
						aria-label="Fit the graph"
						title="Fit the graph"
					>
						<LocateFixedIcon />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						class="size-7 rounded-sm"
						onclick={toggleFullscreen}
						aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
						title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
					>
						{#if fullscreen}<Minimize2Icon />{:else}<Maximize2Icon />{/if}
					</Button>
				</div>
			</div>

			<!-- Legend and status -->
			<div
				class="max-w-72 rounded-lg glass-card px-3 py-2.5 text-[11px] shadow-sm ring-1 ring-foreground/10 max-md:hidden"
			>
				{#if loading}
					<p class="flex items-center gap-1.5 text-muted-foreground">
						<Loader2Icon class="size-3 animate-spin" /> Laying out the graph…
					</p>
				{:else if graphError}
					<p class="text-destructive">{graphError}</p>
				{:else if counts}
					<p class="text-muted-foreground">
						<span class="text-foreground tabular-nums">{num(counts.nodes)}</span> nodes,
						<span class="text-foreground tabular-nums">{num(counts.edges)}</span>
						links{counts.truncated ? ', largest shown' : ''}
					</p>
				{/if}
				<ul class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
					<li class="flex items-center gap-1.5">
						<span class="size-2 rounded-full bg-stop"></span>High criticality
					</li>
					<li class="flex items-center gap-1.5">
						<span class="size-2 rounded-full bg-risky"></span>Medium
					</li>
					<li class="flex items-center gap-1.5">
						<span class="size-2 rounded-full bg-muted-foreground"></span>Low
					</li>
					<li class="flex items-center gap-1.5">
						<span class="size-2 rounded-full ring-1 ring-muted-foreground/60"></span>Outside scope
					</li>
					<li class="flex items-center gap-1.5">
						<span class="h-px w-3 bg-risky"></span>Uncertain link
					</li>
					{#if showCoChange}
						<li class="flex items-center gap-1.5">
							<span class="h-px w-3 bg-pr-merged"></span>Changed together
						</li>
					{/if}
				</ul>
				<p class="mt-2 leading-snug text-muted-foreground">
					Click a node to see what depends on it.
				</p>
			</div>
		</div>

		<!-- Inspector -->
		<aside
			class={cn(
				'absolute top-3 right-3 bottom-28 w-[22rem] max-w-[calc(100%-1.5rem)] overflow-hidden rounded-xl glass-card shadow-xl ring-1 ring-foreground/10',
				'transition-[transform,opacity] duration-300 ease-(--ease-sheet)',
				details
					? 'translate-x-0 opacity-100'
					: 'pointer-events-none translate-x-[calc(100%+1rem)] opacity-0'
			)}
			aria-label="Selected node"
			aria-hidden={!details}
		>
			{#if details}
				{#key selected}
					<NodeInspector
						repo={scan.repo}
						commit={scan.commit}
						{details}
						bind:depth
						chatEnabled={data.llmEnabled}
						onclose={() => (selected = null)}
						onask={ask}
						onpick={pick}
					/>
				{/key}
			{/if}
		</aside>
	{/if}
</div>
