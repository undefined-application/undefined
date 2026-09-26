<script lang="ts">
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import { resolve } from '$app/paths';
	import VerdictChip from '$lib/components/VerdictChip.svelte';
	import { ago } from '$lib/format';
	import type { ReviewSummary } from '$lib/review';

	interface Props {
		/** The system the reviews belong to; they open inside it. */
		scanId: string;
		reviews: ReviewSummary[];
	}

	let { scanId, reviews }: Props = $props();
</script>

<ul class="divide-y divide-border/70 overflow-hidden rounded-xl bg-card ring-1 ring-border">
	{#each reviews as r (r.id)}
		<li>
			<a
				href={resolve(`/scans/${scanId}/pulls/${r.id}`)}
				class="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60"
			>
				<span class="w-[5.75rem] shrink-0">
					{#if r.status === 'done'}
						<VerdictChip verdict={r.verdict} />
					{:else if r.status === 'failed'}
						<span class="inline-flex items-center gap-1 text-[11px] text-destructive">
							<CircleXIcon class="size-3.5" /> Failed
						</span>
					{:else}
						<span class="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
							<Loader2Icon class="size-3.5 animate-spin" /> Reviewing
						</span>
					{/if}
				</span>
				<span class="min-w-0 flex-1 truncate text-[13px]">
					{r.title}
				</span>
				<span class="shrink-0 text-[11px] text-muted-foreground">
					#{r.prNumber}
				</span>
				<span class="hidden w-20 shrink-0 text-right text-[11px] text-muted-foreground sm:block">
					{ago(r.createdAt)}
				</span>
			</a>
		</li>
	{/each}
</ul>
