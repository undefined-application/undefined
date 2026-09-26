<script lang="ts">
	// How much of the analysed system transitively depends on a node (docs/ui-spec.md §4.5).
	// A hero number with a thin arc; the words carry the meaning, colour only repeats it.
	import OctagonAlertIcon from '@lucide/svelte/icons/octagon-alert';
	import RadarIcon from '@lucide/svelte/icons/radar';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion, Tween } from 'svelte/motion';
	import { num, pct, plural } from '$lib/format';
	import type { Reach } from '$lib/model';
	import { cn } from '$lib/utils';

	let { reach }: { reach: Reach } = $props();

	const shown = new Tween(0, { duration: 700, easing: cubicOut });
	$effect(() => {
		shown.set(reach.share, { duration: prefersReducedMotion.current ? 0 : 700 });
	});

	const band = $derived(
		reach.share >= 0.3
			? { label: 'System-wide', tone: 'text-stop', stroke: 'var(--stop)', icon: OctagonAlertIcon }
			: reach.share >= 0.1
				? { label: 'Wide', tone: 'text-risky', stroke: 'var(--risky)', icon: TriangleAlertIcon }
				: { label: 'Contained', tone: 'text-link', stroke: 'var(--link)', icon: RadarIcon }
	);

	// A 270° arc, open at the bottom.
	const R = 42;
	const C = 2 * Math.PI * R;
	const ARC = C * 0.75;
	const maxDepth = $derived(Math.max(1, ...reach.byDepth));
</script>

<div class="grid gap-4">
	<div class="flex items-center gap-4">
		<div class="relative size-28 shrink-0">
			<svg viewBox="0 0 100 100" class="size-full -rotate-[225deg]" aria-hidden="true">
				<circle
					cx="50"
					cy="50"
					r={R}
					fill="none"
					stroke="var(--border)"
					stroke-width="5"
					stroke-linecap="round"
					stroke-dasharray="{ARC} {C}"
				/>
				<circle
					cx="50"
					cy="50"
					r={R}
					fill="none"
					stroke={band.stroke}
					stroke-width="5"
					stroke-linecap="round"
					stroke-dasharray="{Math.max(0.001, shown.current) * ARC} {C}"
				/>
			</svg>
			<div class="absolute inset-0 grid place-content-center text-center">
				<span class="text-[22px] leading-none font-medium tracking-tight tabular-nums">
					{reach.lowerBound && reach.share > 0 ? '≥' : ''}{pct(shown.current)}
				</span>
				<span class="mt-1 text-[10.5px] text-muted-foreground">of files</span>
			</div>
		</div>
		<div class="min-w-0">
			<p class={cn('flex items-center gap-1.5 text-[13px] font-semibold', band.tone)}>
				<band.icon class="size-3.5" aria-hidden="true" />
				{band.label}
			</p>
			<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
				{#if reach.files.affected}
					{plural(reach.files.affected, 'file')} of {num(reach.files.total)} in the analysed scope depend
					on this, directly or through others.
				{:else if reach.symbols.affected}
					Only {plural(reach.symbols.affected, 'function')} in its own file
					{reach.symbols.affected === 1 ? 'depends' : 'depend'} on this.
				{:else}
					Nothing in the analysed scope depends on this.
				{/if}
			</p>
		</div>
	</div>

	<dl class="grid grid-cols-3 gap-2 text-center">
		<div class="rounded-lg bg-muted/60 px-2 py-2">
			<dd class="text-sm font-medium tabular-nums">{num(reach.symbols.affected)}</dd>
			<dt class="text-[10.5px] text-muted-foreground">functions</dt>
		</div>
		<div class="rounded-lg bg-muted/60 px-2 py-2">
			<dd class="text-sm font-medium tabular-nums">
				{num(reach.components.affected)}<span class="text-muted-foreground"
					>/{num(reach.components.total)}</span
				>
			</dd>
			<dt class="text-[10.5px] text-muted-foreground">other components</dt>
		</div>
		<div class="rounded-lg bg-muted/60 px-2 py-2">
			<dd class="text-sm font-medium tabular-nums">{num(reach.maxDepth)}</dd>
			<dt class="text-[10.5px] text-muted-foreground">hops deep</dt>
		</div>
	</dl>

	{#if reach.byDepth.length}
		<div>
			<p class="mb-1.5 text-[11px] text-muted-foreground">Dependents by distance</p>
			<ul class="grid gap-1">
				{#each reach.byDepth.slice(0, 6) as n, i (i)}
					<li class="grid grid-cols-[3.25rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-[11px]">
						<span class="text-muted-foreground">{i + 1} {i ? 'hops' : 'hop'}</span>
						<span
							class="h-1.5 rounded-full"
							style="width: {(n / maxDepth) * 100}%; background: {band.stroke}; opacity: {1 -
								i * 0.12}"
						></span>
						<span class="text-right tabular-nums">{num(n)}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if reach.outside || reach.unresolved}
		<p
			class="rounded-md bg-risky/10 px-2.5 py-2 text-[11.5px] leading-snug text-foreground/90 ring-1 ring-risky/25 ring-inset"
		>
			{#if reach.lowerBound}<strong class="font-medium">At least.</strong>{/if}
			{#if reach.outside}{plural(reach.outside, 'file')} outside the analysed scope also use it.{/if}
			{#if reach.unresolved}{plural(reach.unresolved, 'link')} could not be resolved, so dependents may
				be missing.{/if}
		</p>
	{/if}
</div>
