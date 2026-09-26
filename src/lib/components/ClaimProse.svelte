<script lang="ts">
	// Validated claims read as prose (DeepWiki style). Claims are checked server-side against their
	// evidence; the page shows the sentences and keeps sources to one line under a block.
	import type { Claim } from '$lib/claims';
	import { cn } from '$lib/utils';

	interface Props {
		claims: Claim[];
		class?: string;
	}

	let { claims, class: className }: Props = $props();

	/** Split on `backticks` so code snippets render as code. */
	/** Between two sentences; the spans themselves carry none. */
	const gap = ' ';
	const parts = (text: string) => text.split(/(`[^`]+`)/g).filter(Boolean);
</script>

<p class={cn('text-pretty', className)}>
	{#each claims as c, i (i)}
		{#if i > 0}{gap}{/if}
		<span class={cn(c.status === 'unknown' && 'text-muted-foreground italic')}>
			{#each parts(c.text) as part, j (j)}
				{#if part.startsWith('`')}
					<code class="rounded-[4px] bg-muted px-1 py-px font-sans text-[0.9em] not-italic"
						>{part.slice(1, -1)}</code
					>
				{:else}
					{part}
				{/if}
			{/each}
		</span>
	{/each}
</p>
