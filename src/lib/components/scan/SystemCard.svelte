<script lang="ts">
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { resolve } from '$app/paths';
	import GithubMark from '$lib/components/brand/GithubMark.svelte';
	import { buttonVariants } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { ago, num, shortSha } from '$lib/format';
	import { IMPLEMENTED_STAGES, SCAN_STAGES, type ScanSummary } from '$lib/scan';
	import { cn } from '$lib/utils';

	interface Props {
		scan: ScanSummary;
		/** Other scans of the same repo (older, or other scopes). */
		others: number;
		onrescan: (scan: ScanSummary) => void;
		ondelete: () => void;
	}

	let { scan, others, onrescan, ondelete }: Props = $props();

	const active = $derived(scan.status === 'queued' || scan.status === 'running');
	const [owner, name] = $derived(scan.repo.split('/'));
	const stats = $derived([
		{ label: 'files', value: scan.stats?.deepFiles },
		{ label: 'symbols', value: scan.stats?.structure?.symbols },
		{ label: 'commits', value: scan.stats?.git?.commits },
		{ label: 'critical', value: scan.stats?.signals?.highFunctions }
	]);
	const last = IMPLEMENTED_STAGES.length - 1;
	const progress = $derived(
		scan.status === 'queued'
			? 0.04
			: Math.min(1, (IMPLEMENTED_STAGES.indexOf(scan.stage) + 0.5) / (last + 1))
	);
</script>

<article
	class="group relative flex flex-col rounded-xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-[0_12px_32px_-18px_rgb(28_25_23/0.35)] hover:ring-foreground/15"
>
	<a
		href={resolve(`/scans/${scan.id}/overview`)}
		class="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
		aria-label="Open {scan.repo}"
	></a>

	<header class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="flex min-w-0 items-center gap-1.5 text-[13px]">
				<GithubMark class="size-3.5 shrink-0 text-muted-foreground" />
				<span class="truncate text-muted-foreground">{owner}/</span><span
					class="-ml-1.5 truncate font-medium text-foreground">{name}</span
				>
			</p>
			<p class="mt-1 truncate text-[11.5px] text-muted-foreground">
				{scan.deepScope || 'whole repository'}
			</p>
		</div>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				class={cn(
					buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
					'relative z-10 -mt-1 -mr-1'
				)}
				aria-label="Actions for {scan.repo}"
			>
				<EllipsisIcon />
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="w-48">
				<DropdownMenu.Item onSelect={() => onrescan(scan)} disabled={active}>
					<RefreshCwIcon />
					Scan again
				</DropdownMenu.Item>
				<DropdownMenu.Item>
					{#snippet child({ props })}
						<a {...props} href="https://github.com/{scan.repo}" target="_blank" rel="noreferrer">
							<ExternalLinkIcon />
							Open on GitHub
						</a>
					{/snippet}
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item variant="destructive" onSelect={ondelete} disabled={active}>
					<Trash2Icon />
					Delete repository…
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</header>

	<div class="mt-5 min-h-[3.25rem]">
		{#if scan.status === 'done'}
			<dl class="grid grid-cols-4 gap-2">
				{#each stats as s (s.label)}
					<div>
						<dd class="text-[17px] leading-none font-medium tracking-tight tabular-nums">
							{num(s.value)}
						</dd>
						<dt class="mt-1.5 text-[11px] text-muted-foreground">{s.label}</dt>
					</div>
				{/each}
			</dl>
		{:else if active}
			<p class="flex items-center gap-1.5 text-xs text-foreground">
				<Loader2Icon class="size-3.5 animate-spin text-link" />
				{scan.status === 'queued' ? 'Waiting for the scanner' : SCAN_STAGES[scan.stage]}
			</p>
			<div class="mt-3 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
				<div
					class="h-full rounded-full bg-link transition-[width] duration-700 ease-(--ease-sheet)"
					style="width: {progress * 100}%"
				></div>
			</div>
		{:else}
			<p class="flex items-start gap-1.5 text-xs text-destructive">
				<TriangleAlertIcon class="mt-px size-3.5 shrink-0" />
				<span class="line-clamp-2">{scan.error ?? 'The scan failed.'}</span>
			</p>
		{/if}
	</div>

	<footer
		class="mt-4 flex items-center justify-between gap-2 border-t border-border/70 pt-3 text-[11px] text-muted-foreground"
	>
		<span class="truncate">{scan.ref} @ {shortSha(scan.commit)}</span>
		<span class="shrink-0">
			{#if others}+{others} more{/if}
			{ago(scan.finishedAt ?? scan.createdAt)}
		</span>
	</footer>
</article>
