<script lang="ts">
	import BookOpenTextIcon from '@lucide/svelte/icons/book-open-text';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import OrbitIcon from '@lucide/svelte/icons/orbit';
	import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { prefersReducedMotion } from 'svelte/motion';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { nav } from '$lib/components/shell.svelte';
	import { ago, shortSha } from '$lib/format';
	import type { ScanSummary } from '$lib/scan';
	import { cn } from '$lib/utils';
	import { SECTIONS, toc } from './toc.svelte';

	interface Props {
		scan: ScanSummary;
		/** Docked or floating sidebar (lg and up): offers folding it away, or keeping it open. */
		foldable?: boolean;
		onnavigate?: () => void;
		onrescan: () => void;
		ondelete: () => void;
	}

	let { scan, foldable = false, onnavigate, onrescan, ondelete }: Props = $props();

	const path = $derived(page.url.pathname);
	const base = $derived(`/scans/${scan.id}`);
	const onOverview = $derived(path.endsWith('/overview'));
	const onPulls = $derived(path.startsWith(`${base}/pulls`));
	const active = $derived(scan.status === 'queued' || scan.status === 'running');

	const item =
		'pressable flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground';
	const current = 'bg-sidebar-accent text-foreground font-medium';

	// A bar on the section rail glides to the section in view.
	const links: HTMLAnchorElement[] = $state([]);
	const sections = $derived(SECTIONS.filter((s) => !toc.empty.includes(s.id)));
	const activeIndex = $derived(onOverview ? sections.findIndex((s) => s.id === toc.active) : -1);
	let bar = $state({ top: 0, height: 0 });
	$effect(() => {
		const el = links[activeIndex];
		if (el) bar = { top: el.offsetTop, height: el.offsetHeight };
	});

	// Already on the overview: glide to the section instead of jumping.
	function toSection(e: MouseEvent, id: string) {
		onnavigate?.();
		const target = onOverview && document.getElementById(id);
		if (!target || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		target.scrollIntoView({ behavior: prefersReducedMotion.current ? 'auto' : 'smooth' });
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above, plus a hash
		replaceState(`${resolve(`${base}/overview` as `/scans/${string}/overview`)}#${id}`, page.state);
	}
</script>

<nav
	class="flex h-full scrollbar-thin flex-col gap-6 overflow-y-auto px-3 py-5"
	aria-label="System"
>
	<div class="px-2">
		<p class="truncate text-xs text-muted-foreground">{scan.repo}</p>
		<p class="mt-0.5 truncate text-[13px] font-medium text-foreground">
			{scan.deepScope || 'whole repository'}
		</p>
	</div>

	<div class="grid gap-2">
		<div class="grid gap-0.5">
			<a
				href={resolve(`${base}/overview` as `/scans/${string}/overview`)}
				class={cn(item, onOverview && !toc.active && current)}
				onclick={onnavigate}
				aria-current={onOverview ? 'page' : undefined}
			>
				<BookOpenTextIcon class="size-4" />
				Overview
			</a>
			<ul class="relative ml-[1.1rem] grid gap-px border-l border-border pl-2">
				<span
					class="pointer-events-none absolute -left-px w-0.5 rounded-full bg-foreground transition-[translate,height,opacity] duration-300 ease-(--ease-sheet)"
					style="top: 0; height: {bar.height}px; translate: 0 {bar.top}px; opacity: {activeIndex >=
					0
						? 1
						: 0}"
					aria-hidden="true"
				></span>
				{#each sections as s, i (s.id)}
					<li>
						<a
							bind:this={links[i]}
							href="{resolve(`${base}/overview` as `/scans/${string}/overview`)}#{s.id}"
							onclick={(e) => toSection(e, s.id)}
							aria-current={activeIndex === i ? 'location' : undefined}
							class={cn(
								'block truncate rounded-md px-2 py-1 text-[12.5px] text-muted-foreground transition-[color,translate] duration-300 ease-(--ease-sheet) hover:text-foreground',
								activeIndex === i && 'translate-x-0.5 text-foreground'
							)}
						>
							{s.label}
						</a>
					</li>
				{/each}
			</ul>
		</div>

		<div class="grid gap-0.5">
			<a
				href={resolve(`${base}/graph` as `/scans/${string}/graph`)}
				class={cn(item, path.endsWith('/graph') && current)}
				onclick={onnavigate}
				aria-current={path.endsWith('/graph') ? 'page' : undefined}
			>
				<OrbitIcon class="size-4" />
				System graph
			</a>
			<a
				href={resolve(`${base}/pulls` as `/scans/${string}/pulls`)}
				class={cn(item, onPulls && current)}
				onclick={onnavigate}
				aria-current={onPulls ? 'page' : undefined}
			>
				<GitPullRequestIcon class="size-4" />
				Pull requests
			</a>
		</div>
	</div>

	<div class="mt-auto grid gap-3 px-2">
		<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11.5px]">
			<dt class="text-muted-foreground">Branch</dt>
			<dd class="truncate">{scan.ref}</dd>
			<dt class="text-muted-foreground">Commit</dt>
			<dd>
				<a
					href="https://github.com/{scan.repo}/commit/{scan.commit}"
					target="_blank"
					rel="noreferrer"
					class="text-link hover:underline">{shortSha(scan.commit)}</a
				>
			</dd>
			<dt class="text-muted-foreground">Scanned</dt>
			<dd class="flex items-center gap-1">
				{#if active}<Loader2Icon class="size-3 animate-spin" />running{:else}{ago(
						scan.finishedAt ?? scan.createdAt
					)}{/if}
			</dd>
		</dl>
		<div class="flex flex-wrap gap-1">
			{#if scan.status === 'done'}
				<Button
					href="{resolve('/api/scans/[id]/docs', { id: scan.id })}?format=md"
					download
					variant="outline"
					size="sm"
					class="pressable"
					data-sveltekit-reload
				>
					<DownloadIcon />
					Markdown
				</Button>
			{/if}
			<Button
				variant="ghost"
				size="icon-sm"
				class="pressable"
				disabled={active}
				onclick={onrescan}
				aria-label="Scan again"
				title="Scan again"
			>
				<RefreshCwIcon />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				class="pressable text-muted-foreground hover:text-destructive"
				disabled={active}
				onclick={ondelete}
				aria-label="Delete repository"
				title="Delete repository"
			>
				<Trash2Icon />
			</Button>
			{#if foldable}
				<!-- Folded, the sidebar floats in from the left edge; this docks it again. -->
				<Button
					variant="ghost"
					size="icon-sm"
					class="ml-auto pressable text-muted-foreground hover:text-foreground"
					onclick={() => nav.toggle()}
					aria-label={nav.collapsed ? 'Keep the sidebar open' : 'Hide the sidebar'}
					title={nav.collapsed ? 'Keep the sidebar open' : 'Hide the sidebar'}
				>
					{#if nav.collapsed}<PanelLeftOpenIcon />{:else}<PanelLeftCloseIcon />{/if}
				</Button>
			{/if}
		</div>
	</div>
</nav>
