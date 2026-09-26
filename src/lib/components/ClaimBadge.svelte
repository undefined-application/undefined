<script lang="ts" module>
	// Every claim is Verified, Inferred or Unknown, and each must look different (plan §3 rule 1):
	// solid, dashed and dotted outlines, each with its own icon and word.
	export type ClaimStatus = 'verified' | 'inferred' | 'unknown';
</script>

<script lang="ts">
	import BadgeCheckIcon from '@lucide/svelte/icons/badge-check';
	import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';
	import CircleQuestionMarkIcon from '@lucide/svelte/icons/circle-question-mark';
	import { cn } from '$lib/utils';

	interface Props {
		status: ClaimStatus;
		confidence?: 'low' | 'medium' | 'high';
		class?: string;
	}

	let { status, confidence, class: className }: Props = $props();

	const styles: Record<ClaimStatus, string> = {
		verified: 'border-solid border-safe/40 bg-safe/10 text-safe',
		inferred: 'border-dashed border-risky/50 bg-risky/5 text-risky',
		unknown: 'border-dotted border-muted-foreground/50 text-muted-foreground'
	};
	const icons = {
		verified: BadgeCheckIcon,
		inferred: CircleDashedIcon,
		unknown: CircleQuestionMarkIcon
	};
	const Icon = $derived(icons[status]);
	const label = { verified: 'Verified', inferred: 'Inferred', unknown: 'Unknown' };
</script>

<span
	class={cn(
		'inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-[10.5px] font-medium whitespace-nowrap',
		styles[status],
		className
	)}
>
	<Icon class="size-3" aria-hidden="true" />
	{label[status]}
	{#if status === 'inferred' && confidence}
		<span class="font-normal opacity-75">{confidence}</span>
	{/if}
</span>
