<script lang="ts">
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { browser } from '$app/environment';
	import { apiFetch, redirectOn401 } from '$lib/api';
	import SourceMark from '$lib/components/SourceMark.svelte';
	import ClaimRows from '$lib/components/ClaimRows.svelte';
	import { rescan } from '$lib/components/scan/actions';
	import CriticalPart from '$lib/components/scan/CriticalPart.svelte';
	import FenceRow from '$lib/components/scan/FenceRow.svelte';
	import { HOW, HOW_READING_AI } from '$lib/components/scan/how';
	import ScanFacts from '$lib/components/scan/ScanFacts.svelte';
	import ScanProgress from '$lib/components/scan/ScanProgress.svelte';
	import SystemTakeaways from '$lib/components/scan/SystemTakeaways.svelte';
	import SystemSummary from '$lib/components/scan/SystemSummary.svelte';
	import { chatPanel } from '$lib/components/shell.svelte';
	import { SECTIONS, toc, type SectionId } from '$lib/components/scan/toc.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { basename, num, plural } from '$lib/format';
	import type { Fence, WikiOverview } from '$lib/model';
	import { cn } from '$lib/utils';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const scan = $derived(data.scan);
	const pack = $derived(data.pack);
	const title = $derived(scan.deepScope ? scan.deepScope.split('/').pop()! : scan.repo);
	const scope = $derived(scan.deepScope || 'the repository');

	let allCritical = $state(false);

	$effect(() => {
		if (data.fences instanceof Promise) redirectOn401(data.fences);
	});
	// "Before you change it" counts the fences: at once when the load had them, else once traced.
	let traced = $state<Fence[] | null>(null);
	const fenceList = $derived(
		data.fences && !(data.fences instanceof Promise) ? data.fences.fences : traced
	);
	$effect(() => {
		let live = true;
		traced = null;
		if (!(data.fences instanceof Promise)) return;
		data.fences
			.then((r) => {
				if (live) traced = r.fences;
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	});
	// The model's part of the wiki (intro, what each start file does): generated once and stored on
	// the scan, usually by its last stage. Only a scan without one asks for it here; every section
	// renders without it first.
	let generated = $state<WikiOverview | null>(null);
	let overviewLoading = $state(false);
	const overview = $derived(data.overview ?? generated);
	$effect(() => {
		if (!pack || data.overview || !data.llmEnabled || !browser) return;
		let live = true;
		generated = null;
		overviewLoading = true;
		apiFetch(`/api/scans/${scan.id}/summary`, { method: 'POST' })
			.then(async (res) => (res.ok ? ((await res.json()) as WikiOverview) : null))
			.catch(() => null)
			.then((o) => {
				if (!live) return;
				generated = o;
				overviewLoading = false;
			});
		return () => {
			live = false;
		};
	});
	/** One plain sentence from the stats: what was read and how much history it has. */
	const lede = $derived.by(() => {
		const s = scan.stats;
		if (!s) return '';
		const parts = [
			`${plural(s.deepFiles, 'file')} analysed in depth${s.files > s.deepFiles ? `, ${num(s.files - s.deepFiles)} more indexed for references` : ''}.`
		];
		if (s.git)
			parts.push(
				`${plural(s.git.commits, 'commit')} of history by ${plural(s.git.authors, 'author')}.`
			);
		return parts.join(' ');
	});

	// Sections with nothing in them are left out, here and in the sidebar.
	const empty = $derived.by(() => {
		if (!pack) return [] as SectionId[];
		const out: SectionId[] = [];
		if (!pack.interfaces.length) out.push('interfaces');
		if (!pack.critical.length) out.push('critical');
		if (!pack.assumptions.length) out.push('timing');
		if (!pack.unknowns.length) out.push('questions');
		return out;
	});
	$effect(() => {
		toc.empty = empty;
		return () => (toc.empty = []);
	});

	// Scroll spy: the sidebar highlights the section you are reading, i.e. the last heading above a
	// reading line near the top, so it never blinks off between two headings. At the very bottom
	// the last section wins even if its heading can't reach the line.
	$effect(() => {
		if (!pack) return;
		let frame = 0;
		const update = () => {
			frame = 0;
			const headings = SECTIONS.map((s) => document.getElementById(s.id)).filter((el) => !!el);
			let active: SectionId | null = null;
			for (const el of headings)
				if (el.getBoundingClientRect().top <= 120) active = el.id as SectionId;
			const doc = document.documentElement;
			if (headings.length && window.innerHeight + window.scrollY >= doc.scrollHeight - 4)
				active = headings.at(-1)!.id as SectionId;
			toc.active = active;
		};
		const schedule = () => (frame ||= requestAnimationFrame(update));
		update();
		window.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
			toc.active = null;
		};
	});
</script>

<svelte:head><title>{title} · {scan.repo}</title></svelte:head>

{#snippet heading(id: SectionId, label: string, sub?: string, ai = false)}
	<header class="mb-4">
		<h2 {id} class="flex scroll-mt-20 items-center gap-2 text-lg font-semibold tracking-tight">
			<a href="#{id}" class="hover:underline">{label}</a>
			<SourceMark
				kind={ai ? 'ai' : 'deterministic'}
				how={ai && id === 'reading' ? HOW_READING_AI : HOW[id]}
			/>
		</h2>
		{#if sub}<p class="mt-1 max-w-[62ch] text-[13px] text-muted-foreground">{sub}</p>{/if}
	</header>
{/snippet}

{#snippet fenceSkeleton()}
	<div
		class="divide-y divide-border overflow-hidden rounded-xl ring-1 ring-border"
		aria-hidden="true"
	>
		{#each [0.6, 0.45, 0.55, 0.4] as w, i (i)}
			<div class="grid grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-3 px-3.5 py-3">
				<Skeleton class="h-5 w-14" />
				<div class="grid gap-1.5">
					<Skeleton class="h-3.5" style="width: {w * 100}%" />
					<Skeleton class="h-2.5 w-1/4" />
				</div>
			</div>
		{/each}
	</div>
{/snippet}

<div
	class={cn(
		'mx-auto grid max-w-6xl gap-10 px-4 pt-8 sm:px-8',
		// The chat side panel takes the facts column's place; the facts move below the article.
		chatPanel.open ? 'pb-16' : 'pb-48 xl:grid-cols-[minmax(0,1fr)_16rem]'
	)}
>
	<!-- A size container: its grids follow the article's width, which the chat side panel narrows,
		 not the window's. -->
	<article class="@container min-w-0">
		<header>
			<p class="text-xs text-muted-foreground">{scan.repo}</p>
			<h1 class="mt-1 text-3xl font-semibold tracking-[-0.025em]">{title}</h1>
			{#if overviewLoading || overview?.claims.length}
				<div class="mt-3">
					<SystemSummary claims={overview?.claims ?? []} loading={overviewLoading} />
				</div>
			{:else if lede}
				<p class="mt-3 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
					{lede}<SourceMark kind="deterministic" how={HOW.lede} class="ml-1" />
				</p>
			{/if}
			{#if pack}
				<div class="mt-6">
					<SystemTakeaways
						arch={pack.architecture}
						components={pack.components}
						critical={pack.critical}
						fences={fenceList}
						repo={pack.repo}
						commit={pack.commit}
						scope={title}
					/>
				</div>
			{/if}
		</header>

		{#if scan.status === 'queued' || scan.status === 'running'}
			<section class="mt-8 max-w-[18rem]">
				<h2 class="mb-4 text-sm font-semibold">Scanning</h2>
				<ScanProgress {scan} />
			</section>
		{:else if scan.status === 'failed'}
			<section
				class="mt-8 rounded-xl bg-destructive/5 p-5 ring-1 ring-destructive/25"
				aria-live="polite"
			>
				<p class="flex items-center gap-2 text-sm font-medium text-destructive">
					<TriangleAlertIcon class="size-4" />
					The scan failed
				</p>
				<p class="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-foreground/90">
					{scan.error ?? 'No error was recorded.'}
				</p>
				<Button variant="outline" size="sm" class="mt-4 pressable" onclick={() => rescan(scan)}>
					<RefreshCwIcon />
					Scan again
				</Button>
			</section>
		{:else if !pack}
			<p class="mt-8 text-sm text-destructive">Could not load the wiki: {data.packError}</p>
		{:else}
			<section class="mt-10">
				{@render heading(
					'reading',
					'Where to start',
					'Read these first, in this order.',
					!!overview && Object.keys(overview.files).length > 0
				)}
				<ol class="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-border">
					{#each pack.readingOrder as r, i (r.path)}
						<li class="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3 px-3.5 py-2.5">
							<span class="pt-0.5 text-right text-[12px] text-muted-foreground tabular-nums"
								>{i + 1}</span
							>
							<div class="min-w-0">
								<a
									href="https://github.com/{pack.repo}/blob/{pack.commit}/{r.path}"
									target="_blank"
									rel="noreferrer"
									class="block truncate text-[13.5px] font-medium hover:underline"
									>{basename(r.path)}</a
								>
								<p class="text-[12.5px] leading-relaxed text-muted-foreground">
									{overview?.files[r.path] ?? r.why}
								</p>
								{#if r.functions.length}
									<p
										class="mt-1 flex flex-wrap items-center gap-1 text-[11.5px] text-muted-foreground"
									>
										Start with
										{#each r.functions as fn (fn)}
											<code class="rounded-[4px] bg-muted px-1 py-px font-sans text-foreground/80"
												>{fn}</code
											>
										{/each}
									</p>
								{/if}
							</div>
						</li>
					{/each}
				</ol>
			</section>

			<section class="mt-14">
				{@render heading(
					'fences',
					'What not to break',
					'Code that looks removable, but its history says otherwise.'
				)}
				{#if data.fences}
					{#await data.fences}
						<div aria-busy="true">{@render fenceSkeleton()}</div>
					{:then report}
						{#if report.fences.length}
							<ol
								class="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-border"
							>
								{#each report.fences as fence (fence.id)}
									<li>
										<FenceRow
											{fence}
											repo={pack.repo}
											commit={pack.commit}
											scanId={scan.id}
											llm={data.llmEnabled}
										/>
									</li>
								{/each}
							</ol>
						{:else}
							<p class="text-[13px] text-muted-foreground">
								Nothing in {scope} has a workaround history. That doesn't make it safe to change.
							</p>
						{/if}
					{:catch err}
						<p class="text-[13px] text-destructive">
							Could not trace the line history: {err?.message ?? 'unknown error'}
						</p>
					{/await}
				{/if}
			</section>

			{#if !empty.includes('critical')}
				<section class="mt-14">
					{@render heading(
						'critical',
						'Critical functions',
						'Ranked by risk. Open one to see why.'
					)}
					<ol class="grid gap-px overflow-hidden rounded-xl bg-card p-1 ring-1 ring-border">
						{#each allCritical ? pack.critical : pack.critical.slice(0, 5) as part, i (part.id)}
							<li>
								<CriticalPart
									{part}
									rank={i + 1}
									repo={pack.repo}
									commit={pack.commit}
									scanId={scan.id}
								/>
							</li>
						{/each}
					</ol>
					{#if pack.critical.length > 5}
						<Button
							variant="ghost"
							size="sm"
							class="mt-1.5 -ml-2.5 text-muted-foreground"
							onclick={() => (allCritical = !allCritical)}
						>
							{allCritical ? 'Show fewer' : `Show all ${pack.critical.length}`}
						</Button>
					{/if}
				</section>
			{/if}

			{#if !empty.includes('timing')}
				<section class="mt-14">
					{@render heading(
						'timing',
						'Timing and hardware',
						'Delays, interrupts and register access the code assumes.'
					)}
					<ClaimRows claims={pack.assumptions} repo={pack.repo} />
				</section>
			{/if}

			{#if !empty.includes('interfaces')}
				<section class="mt-14">
					{@render heading(
						'interfaces',
						'External interfaces',
						'What other code relies on. Change these and it notices.'
					)}
					<ClaimRows claims={pack.interfaces} repo={pack.repo} />
				</section>
			{/if}

			{#if !empty.includes('questions')}
				<section class="mt-14">
					{@render heading(
						'questions',
						'Open questions',
						"What the code can't answer, and who to ask."
					)}
					<ClaimRows claims={pack.unknowns} repo={pack.repo} />
				</section>
			{/if}
		{/if}
	</article>

	<!-- Taller than the viewport: scrolls on its own, padded so the chat dock never hides the end. -->
	<aside
		class={chatPanel.open
			? 'border-t pt-8'
			: 'max-xl:border-t max-xl:pt-8 xl:sticky xl:top-20 xl:-mr-2 xl:max-h-[calc(100dvh-5rem)] xl:scrollbar-thin xl:self-start xl:overflow-y-auto xl:pr-2 xl:pb-28'}
	>
		<ScanFacts {scan} />
	</aside>
</div>
