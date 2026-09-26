<script lang="ts">
	// A compact list of claims for the wiki (docs/ui-spec.md §4.3): one row each, the location as a
	// quiet link on the right, Ask-the-author when the claim names someone. Long lists fold.
	import type { Citation, Claim } from '$lib/claims';
	import AskAuthor from '$lib/components/AskAuthor.svelte';
	import { Button } from '$lib/components/ui/button';
	import { basename } from '$lib/format';
	import { cn } from '$lib/utils';

	interface Props {
		claims: Claim[];
		repo: string;
		/** Rows shown before "Show all". */
		max?: number;
	}

	let { claims, repo, max = 5 }: Props = $props();

	let all = $state(false);
	const shown = $derived(all ? claims : claims.slice(0, max));

	/** Split on `backticks` so code snippets render as code. */
	const parts = (text: string) => text.split(/(`[^`]+`)/g).filter(Boolean);
	const where = (c: Citation) =>
		c.kind === 'code' ? `${basename(c.path)}:${c.start}` : c.sha.slice(0, 7);
	const LOCATION =
		'shrink-0 pt-0.5 text-[11.5px] text-muted-foreground tabular-nums hover:text-foreground hover:underline';
</script>

<ul class="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-border">
	{#each shown as claim, i (i)}
		{@const cite = claim.citations[0]}
		<li class="flex items-start gap-3 px-3.5 py-2">
			<p
				class={cn(
					'min-w-0 flex-1 text-[13px] leading-relaxed text-pretty',
					claim.status === 'unknown' && 'text-muted-foreground'
				)}
			>
				{#each parts(claim.text) as part, j (j)}
					{#if part.startsWith('`')}
						<code
							class="rounded-[4px] bg-muted px-1 py-px font-sans text-[12px] break-all text-foreground"
							>{part.slice(1, -1)}</code
						>
					{:else}
						{part}
					{/if}
				{/each}
			</p>
			{#if claim.ask}
				<AskAuthor person={claim.ask} {repo} class="h-5 shrink-0 px-1.5 text-[10.5px]" />
			{/if}
			{#if cite?.kind === 'code'}
				<a
					href="https://github.com/{repo}/blob/{cite.commit}/{cite.path}#L{cite.start}"
					target="_blank"
					rel="noreferrer"
					class={LOCATION}>{where(cite)}</a
				>
			{:else if cite?.kind === 'commit'}
				<a
					href="https://github.com/{repo}/commit/{cite.sha}"
					target="_blank"
					rel="noreferrer"
					class={LOCATION}>{where(cite)}</a
				>
			{/if}
		</li>
	{/each}
</ul>
{#if claims.length > max}
	<Button
		variant="ghost"
		size="sm"
		class="mt-1.5 -ml-2.5 text-muted-foreground"
		onclick={() => (all = !all)}
	>
		{all ? 'Show fewer' : `Show all ${claims.length}`}
	</Button>
{/if}
