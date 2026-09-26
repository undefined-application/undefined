<script lang="ts" module>
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import OctagonAlertIcon from '@lucide/svelte/icons/octagon-alert';
	import OctagonXIcon from '@lucide/svelte/icons/octagon-x';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import type { Verdict } from '$lib/review';

	/** Status colour + icon + word: never colour alone. */
	export const VERDICT = {
		SAFE: { icon: CircleCheckIcon, text: 'text-safe', bg: 'bg-safe/10', ring: 'ring-safe/25' },
		RISKY: {
			icon: TriangleAlertIcon,
			text: 'text-risky',
			bg: 'bg-risky/10',
			ring: 'ring-risky/30'
		},
		DANGEROUS: {
			icon: OctagonAlertIcon,
			text: 'text-dangerous',
			bg: 'bg-dangerous/10',
			ring: 'ring-dangerous/30'
		},
		STOP: { icon: OctagonXIcon, text: 'text-stop', bg: 'bg-stop/10', ring: 'ring-stop/30' }
	} satisfies Record<Verdict, { icon: unknown; text: string; bg: string; ring: string }>;
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		verdict: Verdict | null;
		class?: string;
	}

	let { verdict, class: className }: Props = $props();
	const style = $derived(verdict ? VERDICT[verdict] : null);
</script>

{#if style}
	<span
		class={cn(
			'inline-flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[10.5px] font-semibold tracking-wide ring-1 ring-inset',
			style.text,
			style.bg,
			style.ring,
			className
		)}
	>
		<style.icon class="size-3" aria-hidden="true" />
		{verdict}
	</span>
{:else}
	<span
		class={cn(
			'inline-flex h-5 items-center rounded-sm px-1.5 text-[10.5px] text-muted-foreground ring-1 ring-border ring-inset',
			className
		)}>No verdict</span
	>
{/if}
