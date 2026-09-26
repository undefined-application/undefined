<script lang="ts">
	// GitHub's pull request list (docs/ui-spec.md §4.6): Open / Closed, one row per PR, the verdict if
	// it has been reviewed, else a Review button. Reviews start from here.
	import { apiFetch } from '$lib/api';
	import GitBranchIcon from '@lucide/svelte/icons/git-branch';
	import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import SearchIcon from '@lucide/svelte/icons/search';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { toast } from 'svelte-sonner';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import GithubMark from '$lib/components/brand/GithubMark.svelte';
	import VerdictChip from '$lib/components/VerdictChip.svelte';
	import { Button } from '$lib/components/ui/button';
	import { ago } from '$lib/format';
	import type { PullSummary } from '$lib/github';
	import type { ReviewSummary } from '$lib/review';
	import { cn } from '$lib/utils';
	import PullStateIcon from './PullStateIcon.svelte';

	interface Props {
		repo: string;
		/** The system the reviews open inside. */
		scanId: string;
		reviews: ReviewSummary[];
	}

	let { repo, scanId, reviews }: Props = $props();

	let pullState = $state<'open' | 'closed'>('open');
	let filter = $state('');
	let number = $state('');
	let starting = $state<number | null>(null);

	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- request cache, never rendered
	const cache = new Map<string, Promise<PullSummary[]>>();
	/** Server render: stay on the skeleton; the browser fetches after hydration. */
	const pending = new Promise<PullSummary[]>(() => {});
	function pulls(s: 'open' | 'closed') {
		if (!browser) return pending;
		const key = `${repo}:${s}`;
		let p = cache.get(key);
		if (!p) {
			p = apiFetch(`/api/github/repos/${repo}/pulls?state=${s}`).then(async (res) => {
				const body = await res.json().catch(() => null);
				if (!res.ok) throw new Error(body?.message ?? res.statusText);
				return body as PullSummary[];
			});
			cache.set(key, p);
		}
		return p;
	}
	const list = $derived(pulls(pullState));
	const openCount = $derived(pulls('open'));

	/** Latest finished (or running) review per PR number. */
	const reviewOf = $derived(new Map([...reviews].reverse().map((r) => [r.prNumber, r])));

	function visible(prs: PullSummary[]) {
		const q = filter.trim().toLowerCase().replace(/^#/, '');
		return prs.filter(
			(p) => !q || p.title.toLowerCase().includes(q) || String(p.number).startsWith(q)
		);
	}

	async function review(prNumber: number) {
		starting = prNumber;
		try {
			const res = await apiFetch('/api/reviews', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ repo, pr_number: prNumber })
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.message ?? res.statusText);
			await goto(resolve(`/scans/${scanId}/pulls/${body.review_id}`));
		} catch (err) {
			toast.error(`Could not review #${prNumber}`, { description: (err as Error).message });
		} finally {
			starting = null;
		}
	}
</script>

<div class="grid gap-3">
	<div class="flex flex-wrap items-center gap-2">
		<div class="relative min-w-48 flex-1">
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
			/>
			<input
				bind:value={filter}
				placeholder="Filter by title or number"
				aria-label="Filter pull requests"
				class="h-8 w-full rounded-md bg-card pr-2 pl-8 text-xs ring-1 ring-border outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
			/>
		</div>
		<form
			class="flex items-center gap-1"
			onsubmit={(e) => {
				e.preventDefault();
				if (/^\d+$/.test(number.trim())) review(Number(number.trim()));
			}}
		>
			<div
				class="flex h-8 items-center rounded-md bg-card pl-2.5 text-xs ring-1 ring-border focus-within:ring-2 focus-within:ring-ring/40"
			>
				<span class="text-muted-foreground">#</span>
				<input
					bind:value={number}
					inputmode="numeric"
					placeholder="21937"
					aria-label="Pull request number"
					class="h-full w-16 bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground/60"
				/>
			</div>
			<Button
				type="submit"
				variant="outline"
				class="h-8 pressable"
				disabled={!/^\d+$/.test(number.trim()) || starting !== null}
			>
				Review
			</Button>
		</form>
	</div>

	<div class="overflow-hidden rounded-xl bg-card ring-1 ring-border">
		<div class="flex items-center gap-4 border-b border-border bg-muted/40 px-4 py-2.5 text-xs">
			<button
				type="button"
				class={cn(
					'inline-flex items-center gap-1.5 transition-colors',
					pullState === 'open'
						? 'font-semibold text-foreground'
						: 'text-muted-foreground hover:text-foreground'
				)}
				onclick={() => (pullState = 'open')}
			>
				<GitPullRequestIcon class="size-3.5" />
				{#await openCount}Open{:then prs}{prs.length}{prs.length === 50 ? '+' : ''} Open{:catch}Open{/await}
			</button>
			<button
				type="button"
				class={cn(
					'inline-flex items-center gap-1.5 transition-colors',
					pullState === 'closed'
						? 'font-semibold text-foreground'
						: 'text-muted-foreground hover:text-foreground'
				)}
				onclick={() => (pullState = 'closed')}
			>
				<CheckIcon class="size-3.5" />
				Closed
			</button>
		</div>
		{#await list}
			<ul class="divide-y divide-border/70" aria-busy="true">
				{#each [0, 1, 2, 3, 4] as i (i)}
					<li class="flex items-center gap-3 px-4 py-3">
						<div class="size-4 animate-pulse rounded-full bg-muted"></div>
						<div class="grid flex-1 gap-1.5">
							<div class="h-3 w-2/3 animate-pulse rounded bg-muted"></div>
							<div class="h-2.5 w-1/3 animate-pulse rounded bg-muted"></div>
						</div>
					</li>
				{/each}
			</ul>
		{:then prs}
			{@const shown = visible(prs)}
			<ul class="divide-y divide-border/70">
				{#each shown as pr (pr.number)}
					{@const r = reviewOf.get(pr.number)}
					<!-- The whole row is the primary action (open the review, or start one); other controls sit above it. -->
					<li
						class="group relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
					>
						<PullStateIcon state={pr.state} merged={pr.merged} class="mt-0.5" />
						<div class="min-w-0 flex-1">
							{#if r}
								<a
									href={resolve(`/scans/${scanId}/pulls/${r.id}`)}
									class="text-[13.5px] leading-snug font-semibold text-foreground outline-none after:absolute after:inset-0 focus-visible:underline"
								>
									{pr.title}
								</a>
							{:else}
								<button
									type="button"
									class="text-left text-[13.5px] leading-snug font-semibold text-foreground outline-none after:absolute after:inset-0 focus-visible:underline disabled:cursor-default"
									disabled={starting !== null}
									onclick={() => review(pr.number)}
								>
									{pr.title}
								</button>
							{/if}
							<p
								class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground"
							>
								<span>#{pr.number} by {pr.author}, updated {ago(pr.updatedAt)}</span>
								<span class="inline-flex items-center gap-1">
									<GitBranchIcon class="size-3" />
									{pr.headRef} into {pr.baseRef}
								</span>
							</p>
						</div>
						<div class="relative flex shrink-0 items-center gap-2">
							{#if r}
								{#if r.status === 'done'}
									<VerdictChip verdict={r.verdict} />
								{:else}
									<span class="text-[11px] text-muted-foreground">{r.status}</span>
								{/if}
							{/if}
							<!-- eslint-disable svelte/no-navigation-without-resolve -- GitHub URL, not an app route -->
							<a
								href={pr.url}
								target="_blank"
								rel="noreferrer"
								class="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								title="Open on GitHub"
								aria-label="Open #{pr.number} on GitHub"
							>
								<GithubMark class="size-3.5" />
							</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
							<Button
								variant={r ? 'ghost' : 'outline'}
								size="sm"
								class="pressable"
								disabled={starting !== null}
								onclick={() => review(pr.number)}
							>
								{#if starting === pr.number}<Loader2Icon class="animate-spin" />{/if}
								{r ? 'Again' : 'Review'}
							</Button>
						</div>
					</li>
				{:else}
					<li class="px-4 py-10 text-center text-xs text-muted-foreground">
						{filter ? 'No pull requests match.' : `No ${pullState} pull requests.`}
					</li>
				{/each}
			</ul>
		{:catch err}
			<p class="px-4 py-6 text-xs text-destructive">{err.message}</p>
		{/await}
	</div>
</div>
