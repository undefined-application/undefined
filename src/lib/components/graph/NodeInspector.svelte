<script lang="ts">
	// Right-hand panel of the graph: what the selected node is, how far a change to it reaches,
	// and the evidence behind its criticality (plan §5 Tab 3 "Click a node").
	import BoxesIcon from '@lucide/svelte/icons/boxes';
	import BracesIcon from '@lucide/svelte/icons/braces';
	import FileCodeIcon from '@lucide/svelte/icons/file-code';
	import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
	import XIcon from '@lucide/svelte/icons/x';
	import AskAuthor from '$lib/components/AskAuthor.svelte';
	import LevelBadge from '$lib/components/LevelBadge.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import { basename, num, shortSha } from '$lib/format';
	import type { NodeDetails, Reach } from '$lib/model';
	import type { ReviewResult } from '$lib/review';
	import { cn } from '$lib/utils';
	import BlastMeter from './BlastMeter.svelte';

	type Impact = ReviewResult['impact'];

	interface Props {
		repo: string;
		commit: string;
		details: Promise<{ details: NodeDetails; reach: Reach; impact: Impact | null }>;
		depth: number;
		chatEnabled: boolean;
		onclose: () => void;
		onask: (question: string) => void;
		onpick: (id: string) => void;
	}

	let {
		repo,
		commit,
		details,
		depth = $bindable(),
		chatEnabled,
		onclose,
		onask,
		onpick
	}: Props = $props();

	const kindIcon = { component: BoxesIcon, file: FileCodeIcon } as Record<string, typeof BoxesIcon>;

	type Loaded = Awaited<Props['details']>;

	// Keep the last result on screen while a new depth loads, so the slider stays mounted
	// mid-drag and the panel keeps its scroll position. A new node remounts this component.
	let loaded = $state.raw<Loaded | null>(null);
	let error = $state<string | null>(null);
	let refreshing = $state(false);

	$effect(() => {
		const pending = details;
		let current = true;
		refreshing = true;
		pending
			.then((v) => {
				if (!current) return;
				loaded = v;
				error = null;
			})
			.catch((e: Error) => {
				if (current) error = e.message;
			})
			.finally(() => {
				if (current) refreshing = false;
			});
		return () => {
			current = false;
		};
	});
</script>

<div class="flex h-full flex-col">
	{#if error && !loaded}
		<div class="flex items-start justify-between gap-2 p-4">
			<p class="text-xs text-destructive">{error}</p>
			<Button variant="ghost" size="icon-sm" onclick={onclose} aria-label="Close"><XIcon /></Button>
		</div>
	{:else if !loaded}
		<div class="grid gap-3 p-4" aria-live="polite">
			<div class="h-4 w-2/3 animate-pulse rounded bg-muted"></div>
			<div class="h-3 w-1/2 animate-pulse rounded bg-muted"></div>
			<div class="mt-4 size-28 animate-pulse rounded-full bg-muted"></div>
			<div class="h-3 w-full animate-pulse rounded bg-muted"></div>
		</div>
	{:else}
		{@const { details: d, reach, impact } = loaded}
		{@const Icon = kindIcon[d.node.kind] ?? BracesIcon}
		<header class="flex items-start gap-2 border-b border-border/70 p-4 pb-3">
			<span
				class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-muted ring-1 ring-border"
			>
				<Icon class="size-3.5 text-muted-foreground" />
			</span>
			<div class="min-w-0 flex-1">
				<h2 class="text-[13px] leading-snug font-medium break-all">{d.node.label}</h2>
				<p class="mt-0.5 truncate text-[11px] text-muted-foreground">
					{#if d.node.path}
						<a
							class="hover:text-link hover:underline"
							href="https://github.com/{repo}/blob/{commit}/{d.node.path}{d.node.start
								? `#L${d.node.start}-L${d.node.end}`
								: ''}"
							target="_blank"
							rel="noreferrer"
							>{basename(d.node.path)}{d.node.start && d.node.kind !== 'file'
								? `:${d.node.start}-${d.node.end}`
								: ''}</a
						>
					{:else}
						{d.node.kind}
					{/if}
				</p>
			</div>
			<Button variant="ghost" size="icon-sm" onclick={onclose} aria-label="Close">
				<XIcon />
			</Button>
		</header>

		<div class="flex-1 scrollbar-thin space-y-6 overflow-y-auto p-4">
			<div class="flex flex-wrap items-center gap-2">
				<LevelBadge level={d.node.level} />
				<span class="text-[11px] text-muted-foreground">score {d.node.score}</span>
				{#if d.ask}
					<AskAuthor
						person={d.ask}
						{repo}
						about={d.node.path
							? `${basename(d.node.path)}${d.node.start ? `:${d.node.start}` : ''}`
							: d.node.label}
						class="ml-auto"
					/>
				{/if}
			</div>

			<section>
				<h3 class="mb-3 text-xs font-semibold">Blast radius</h3>
				<BlastMeter {reach} />
				{#if chatEnabled}
					<Button
						variant="outline"
						size="sm"
						class="mt-3 w-full pressable"
						onclick={() =>
							onask(
								`What depends on ${d.node.label}, and what could break if I change it? Mention timing and hardware assumptions.`
							)}
					>
						<MessagesSquareIcon />
						Ask what breaks if this changes
					</Button>
				{/if}
			</section>

			{#if impact}
				<section>
					<div class="mb-2 flex items-center justify-between gap-3">
						<h3 class="text-xs font-semibold">Dependents</h3>
						<span class="text-[11px] text-muted-foreground">up to {depth} hops</span>
					</div>
					<Slider
						type="single"
						min={1}
						max={5}
						step={1}
						bind:value={depth}
						aria-label="Depth"
						class="mb-3"
					/>
					{#if impact.nodes.length}
						<ul
							class={cn(
								'max-h-56 scrollbar-thin space-y-0.5 overflow-y-auto pr-1 transition-opacity',
								refreshing && 'opacity-60'
							)}
							aria-busy={refreshing}
						>
							{#each impact.nodes as n (n.id)}
								<li>
									<button
										type="button"
										class={cn(
											'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11.5px] transition-colors hover:bg-muted',
											n.boundary && 'text-muted-foreground'
										)}
										style="padding-left: {0.375 + (n.depth - 1) * 0.75}rem"
										onclick={() => onpick(n.id)}
									>
										<span class="min-w-0 flex-1 truncate">{n.label}</span>
										{#if n.boundary}<span class="shrink-0 text-[10px]">outside</span>{/if}
										{#if n.resolution !== 'resolved'}
											<span class="shrink-0 text-[10px] text-risky">{n.resolution}</span>
										{/if}
									</button>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-xs text-muted-foreground">No dependents within {depth} hops.</p>
					{/if}
				</section>
			{/if}

			{#if d.factors.length}
				<section>
					<h3 class="mb-2 text-xs font-semibold">Why it ranks</h3>
					<ul class="grid gap-1">
						{#each d.factors.slice(0, 8) as f (f.factor + f.detail)}
							<li class="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-2 text-[11.5px]">
								<span class="text-right text-foreground tabular-nums">+{f.points}</span>
								<span class="min-w-0">
									{f.factor.replaceAll('_', ' ')}
									<span class="block truncate text-muted-foreground" title={f.detail}
										>{f.detail}</span
									>
								</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if d.signals.length}
				<section>
					<h3 class="mb-2 text-xs font-semibold">Signals</h3>
					<ul class="grid gap-2">
						{#each d.signals.slice(0, 10) as s, i (i)}
							<li class="text-[11.5px]">
								<div class="flex items-center gap-2">
									<span class="font-medium">{s.kind.replaceAll('_', ' ')}</span>
									<a
										class="text-link hover:underline"
										href="https://github.com/{repo}/blob/{commit}/{s.path}#L{s.line}"
										target="_blank"
										rel="noreferrer">{basename(s.path)}:{s.line}</a
									>
								</div>
								<code
									class="mt-0.5 block truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground"
									title={s.snippet}>{s.snippet}</code
								>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if d.commits.length}
				<section>
					<h3 class="mb-2 text-xs font-semibold">Recent commits</h3>
					<ul class="grid gap-1.5">
						{#each d.commits.slice(0, 6) as c (c.sha)}
							<li class="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-2 text-[11.5px]">
								<a
									class="text-link hover:underline"
									href="https://github.com/{repo}/commit/{c.sha}"
									target="_blank"
									rel="noreferrer">{shortSha(c.sha)}</a
								>
								<span class="min-w-0">
									<span class="line-clamp-2">{c.subject}</span>
									{#if c.revert || c.rationale || c.bugfix}
										<span
											class={cn(
												'text-[10.5px]',
												c.revert ? 'text-stop' : c.rationale ? 'text-dangerous' : 'text-risky'
											)}
										>
											{c.revert ? 'revert' : c.rationale ? 'hardware or timing reason' : 'bug fix'}
										</span>
									{/if}
								</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if d.authors.length || d.coChange.length}
				<section>
					<h3 class="mb-2 text-xs font-semibold">People and coupling</h3>
					{#if d.authors.length}
						<ul class="mb-3 grid gap-1">
							{#each d.authors as a (a.email)}
								<li class="flex justify-between gap-2 text-[11.5px]">
									<span class="truncate">{a.name}</span>
									<span class="text-muted-foreground tabular-nums">{num(a.commits)}</span>
								</li>
							{/each}
						</ul>
					{/if}
					{#if d.coChange.length}
						<p class="mb-1 text-[11px] text-muted-foreground">
							Often changed together (correlation, not dependency)
						</p>
						<ul class="grid gap-1">
							{#each d.coChange as c, i (i)}
								<li class="flex justify-between gap-2 text-[11.5px]">
									<span class="truncate">{basename(c.path)}</span>
									<span class="text-muted-foreground">{c.count}×</span>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		</div>
	{/if}
</div>
