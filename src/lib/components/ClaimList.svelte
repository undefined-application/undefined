<script lang="ts">
	import type { Claim } from '$lib/claims';
	import { cn } from '$lib/utils';
	import AskAuthor from './AskAuthor.svelte';
	import CitationChip from './CitationChip.svelte';
	import ClaimBadge from './ClaimBadge.svelte';

	interface Props {
		claims: Claim[];
		repo: string;
		class?: string;
	}

	let { claims, repo, class: className }: Props = $props();

	/** Split on `backticks` so code snippets render as code. */
	const parts = (text: string) => text.split(/(`[^`]+`)/g).filter(Boolean);
</script>

<ul class={cn('grid gap-3', className)}>
	{#each claims as claim, i (i)}
		<li class="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1.5">
			<ClaimBadge status={claim.status} confidence={claim.confidence} class="mt-px" />
			<p
				class={cn(
					'text-[13px] leading-relaxed text-pretty',
					claim.status === 'unknown' ? 'text-muted-foreground italic' : 'text-foreground'
				)}
			>
				{#each parts(claim.text) as part, j (j)}
					{#if part.startsWith('`')}
						<code
							class="rounded-[4px] bg-muted px-1 py-px font-sans text-[11.5px] break-all text-foreground not-italic"
							>{part.slice(1, -1)}</code
						>
					{:else}
						{part}
					{/if}
				{/each}
			</p>
			{#if claim.citations.length || claim.ask}
				<div class="col-start-2 flex flex-wrap items-center gap-1.5">
					{#each claim.citations as c, k (k)}
						<CitationChip citation={c} {repo} />
					{/each}
					{#if claim.ask}
						<AskAuthor person={claim.ask} {repo} class="h-5 px-1.5 text-[10.5px]" />
					{/if}
				</div>
			{/if}
		</li>
	{/each}
</ul>
