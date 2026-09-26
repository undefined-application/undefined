<script lang="ts">
	// One "What not to break" row (docs/ui-spec.md §4.3). Closed: verdict, what it guards, where,
	// whether a change to it was reverted. Open: the code, what it protects against in plain words
	// (the model, asked only once the row opens), one line of history whose quotes link to the
	// commits, and the actions.
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import OrbitIcon from '@lucide/svelte/icons/orbit';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { getJson } from '$lib/api';
	import type { Claim } from '$lib/claims';
	import AskAuthor from '$lib/components/AskAuthor.svelte';
	import SourceMark from '$lib/components/SourceMark.svelte';
	import ClaimProse from '$lib/components/ClaimProse.svelte';
	import VerdictChip from '$lib/components/VerdictChip.svelte';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { bareSubject, basename, month, plural } from '$lib/format';
	import type { Fence, FenceReading } from '$lib/model';
	import type { Verdict } from '$lib/review';
	import { cn } from '$lib/utils';

	interface Props {
		fence: Fence;
		repo: string;
		commit: string;
		scanId: string;
		/** A model is configured: ask it to read the fence when the row opens. */
		llm?: boolean;
		open?: boolean;
	}

	let { fence, repo, commit, scanId, llm = false, open = $bindable(false) }: Props = $props();

	const BAR: Record<Verdict, string> = {
		STOP: 'bg-stop',
		DANGEROUS: 'bg-dangerous',
		RISKY: 'bg-risky',
		SAFE: 'bg-safe'
	};
	const LINK =
		'underline decoration-border underline-offset-2 transition-colors hover:text-foreground hover:decoration-current';

	const lines = (start: number, end: number) => (end > start ? `${start}-${end}` : `${start}`);
	const commitUrl = (sha: string) => `https://github.com/${repo}/commit/${sha}`;

	const name = $derived(fence.fn.name.split('::').pop()!);
	const about = $derived(`${basename(fence.path)}:${fence.start}`);
	const inFocus = (line: number) => line >= fence.start && line <= fence.end;
	const later = $derived.by(() => {
		const days = fence.reverted?.days ?? 0;
		return days <= 0 ? 'the same day' : `${plural(days, 'day')} later`;
	});

	/** The model's reading, asked for once the row is open; cached server-side by input hash. */
	const reading = $derived.by(() => {
		if (!open || !llm || !browser) return null;
		const p = getJson<FenceReading>(
			fetch,
			`/api/scans/${scanId}/fences/reading?fence=${encodeURIComponent(fence.id)}`
		);
		p.catch(() => {});
		return p;
	});
	const plain = (r: FenceReading) =>
		[r.protects, r.ifRemoved].filter((c): c is Claim => !!c && c.status !== 'unknown');
</script>

<Collapsible.Root bind:open class="group/row">
	<Collapsible.Trigger
		class="grid w-full grid-cols-[5.25rem_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
	>
		<VerdictChip verdict={fence.verdict} class="justify-self-start" />
		<span class="min-w-0">
			<span
				class="block truncate text-[13.5px] font-medium group-data-[state=open]/row:whitespace-normal"
				title={fence.title}>{fence.title}</span
			>
			<span class="block truncate text-[11.5px] text-muted-foreground">
				{name} · {basename(fence.path)}:<span class="tabular-nums"
					>{lines(fence.start, fence.end)}</span
				>
			</span>
		</span>
		<span class="flex items-center gap-3 text-[11.5px] text-muted-foreground">
			{#if fence.reverted}
				<span class="inline-flex items-center gap-1 text-dangerous max-sm:hidden">
					<RotateCcwIcon class="size-3" aria-hidden="true" />
					reverted once
				</span>
			{/if}
			{#if fence.origin}
				<span class="tabular-nums max-sm:hidden">{fence.origin.date.slice(0, 4)}</span>
			{/if}
			<ChevronRightIcon
				class="size-4 transition-transform duration-200 group-data-[state=open]/row:rotate-90"
			/>
		</span>
	</Collapsible.Trigger>

	<Collapsible.Content>
		<div class="grid gap-3 px-3.5 pt-1 pb-4 sm:pl-[calc(5.25rem+1.625rem)]">
			<div
				class="scrollbar-thin overflow-x-auto rounded-lg bg-muted/30 py-1.5 font-mono text-[11.5px] leading-[1.6] ring-1 ring-border"
			>
				<table class="w-full border-collapse">
					<tbody>
						{#each fence.code.lines as text, i (i)}
							{@const line = fence.code.start + i}
							<tr class={cn(inFocus(line) && 'bg-muted')}>
								<td class={cn('w-0.5 min-w-0.5 p-0', inFocus(line) && BAR[fence.verdict])}></td>
								<td
									class={cn(
										'w-11 min-w-11 pr-3 text-right tabular-nums select-none',
										inFocus(line) ? 'text-muted-foreground' : 'text-muted-foreground/50'
									)}>{line}</td
								>
								<td
									class={cn(
										'pr-4 whitespace-pre',
										inFocus(line) ? 'text-foreground' : 'text-muted-foreground'
									)}
									style="tab-size: 4">{text}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if reading}
				{#await reading}
					<div class="grid gap-1.5" aria-busy="true">
						<Skeleton class="h-3 w-11/12" />
						<Skeleton class="h-3 w-2/3" />
					</div>
				{:then r}
					{#if plain(r).length}
						<div class="text-[13px] leading-relaxed">
							<ClaimProse claims={plain(r)} class="inline" />
							<SourceMark kind="ai" class="ml-1" />
						</div>
					{/if}
				{:catch}
					<!-- The history below doesn't depend on the model. -->
				{/await}
			{/if}

			<p class="text-[12.5px] leading-relaxed text-pretty text-muted-foreground">
				{#if fence.origin}
					{@const o = fence.origin}
					{o.author} wrote it in {month(o.date)}:
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- GitHub commit -->
					<a href={commitUrl(o.sha)} target="_blank" rel="noreferrer" class={LINK}
						>“{o.stated === 'body' ? o.said : bareSubject(o.said)}”</a
					>.
				{:else}
					No commit message says why these lines exist.
				{/if}
				{#if fence.reverted}
					{@const r = fence.reverted}
					{r.change.author}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- GitHub commit -->
					<a href={commitUrl(r.change.sha)} target="_blank" rel="noreferrer" class={LINK}
						>changed it</a
					>
					in {month(r.change.date)} and it was
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- GitHub commit -->
					<a href={commitUrl(r.revert.sha)} target="_blank" rel="noreferrer" class={LINK}
						>reverted</a
					>
					{later}{#if r.reason}: “{r.reason}”{:else}.{/if}
				{/if}
			</p>

			<div class="flex flex-wrap items-center gap-1.5">
				{#if fence.ask}
					{#if reading}
						{#await reading}
							<AskAuthor person={fence.ask} {repo} {about} />
						{:then r}
							<AskAuthor
								person={fence.ask}
								{repo}
								{about}
								question={r.question
									? `Hi ${fence.ask.name.split(' ')[0]}, about ${about} in ${repo}: ${r.question}`
									: undefined}
							/>
						{:catch}
							<AskAuthor person={fence.ask} {repo} {about} />
						{/await}
					{:else}
						<AskAuthor person={fence.ask} {repo} {about} />
					{/if}
				{/if}
				<a
					href="{resolve(`/scans/${scanId}/graph`)}?level=symbol&file={encodeURIComponent(
						fence.path
					)}&focus={encodeURIComponent(fence.fn.id)}"
					class="inline-flex h-6 pressable items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground ring-1 ring-border transition-colors hover:bg-muted hover:text-foreground"
				>
					<OrbitIcon class="size-3" />
					Blast radius
				</a>
				<a
					href="https://github.com/{repo}/blob/{commit}/{fence.path}#L{fence.start}-L{fence.end}"
					target="_blank"
					rel="noreferrer"
					class="inline-flex h-6 items-center px-1 text-xs text-link hover:underline"
				>
					Read the code
				</a>
			</div>
		</div>
	</Collapsible.Content>
</Collapsible.Root>
