<script lang="ts">
	// The wiki's opening lines (docs/ui-spec.md §4.3): the model's two sentences, each validated
	// server-side against include lines, code and commits, and marked as AI. The page fetches the
	// overview once (it also feeds the architecture and the start files) and passes it in.
	import type { Claim } from '$lib/claims';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import SourceMark from '$lib/components/SourceMark.svelte';
	import ClaimProse from '$lib/components/ClaimProse.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';

	interface Props {
		claims: Claim[];
		loading?: boolean;
	}

	let { claims, loading = false }: Props = $props();

	const shown = $derived(claims.filter((c) => c.status !== 'unknown'));
</script>

{#if loading}
	<div class="grid max-w-[64ch] gap-2 pt-1" aria-busy="true">
		<p class="flex items-center gap-1.5 text-[13px] text-muted-foreground" role="status">
			<SparklesIcon class="size-3.5 shrink-0" aria-hidden="true" />
			<span class="shimmer">Generating an overview…</span>
		</p>
		<Skeleton class="h-3.5 w-full" />
		<Skeleton class="h-3.5 w-3/5" />
	</div>
{:else if shown.length}
	<div class="max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
		<ClaimProse claims={shown} class="inline" />
		<SourceMark kind="ai" class="ml-1" />
	</div>
{/if}

<style>
	/* A light sweep across the text while the model writes. */
	.shimmer {
		background:
			linear-gradient(
					90deg,
					transparent 0%,
					color-mix(in oklch, var(--foreground) 70%, transparent) 50%,
					transparent 100%
				) -100%
				0 / 50% 100% no-repeat,
			var(--muted-foreground);
		background-clip: text;
		color: transparent;
		animation: shimmer 1.8s linear infinite;
	}
	@keyframes shimmer {
		to {
			background-position: 200% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.shimmer {
			animation: none;
			color: inherit;
			background: none;
		}
	}
</style>
