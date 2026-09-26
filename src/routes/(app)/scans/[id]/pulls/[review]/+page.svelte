<script lang="ts">
	import { apiFetch } from '$lib/api';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical';
	import GitBranchIcon from '@lucide/svelte/icons/git-branch';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import MessageCircleQuestionIcon from '@lucide/svelte/icons/message-circle-question-mark';
	import OrbitIcon from '@lucide/svelte/icons/orbit';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import UserRoundPenIcon from '@lucide/svelte/icons/user-round-pen';
	import { toast } from 'svelte-sonner';
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import AskAuthor from '$lib/components/AskAuthor.svelte';
	import LogoMark from '$lib/components/brand/LogoMark.svelte';
	import ClaimList from '$lib/components/ClaimList.svelte';
	import DiffView, { CHANGE_CLASS } from '$lib/components/review/DiffView.svelte';
	import ImpactGraph from '$lib/components/review/ImpactGraph.svelte';
	import OverrideDialog from '$lib/components/review/OverrideDialog.svelte';
	import PullStateIcon from '$lib/components/review/PullStateIcon.svelte';
	import VerdictChip, { VERDICT } from '$lib/components/VerdictChip.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tabs from '$lib/components/ui/tabs';
	import type { Person } from '$lib/claims';
	import { ago, num, plural, shortSha } from '$lib/format';
	import type { Verdict } from '$lib/review';
	import { cn } from '$lib/utils';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const review = $derived(data.review);
	const r = $derived(review.result);
	const running = $derived(review.status === 'queued' || review.status === 'running');
	const verdict = $derived((review.verdict ?? r?.verdict ?? null) as Verdict | null);

	// Poll by re-running the page load while the review is in progress.
	$effect(() => {
		if (!running) return;
		const timer = setInterval(() => invalidate('app:review'), 1500);
		return () => clearInterval(timer);
	});

	let tab = $state('conversation');
	let overrideOpen = $state(false);

	const reviewed: Record<Verdict, string> = {
		STOP: 'blocked this pull request',
		DANGEROUS: 'requested changes',
		RISKY: 'asks for a careful review',
		SAFE: 'approved these changes'
	};
	const merge: Record<Verdict, { title: string; sub: string }> = {
		STOP: {
			title: 'Merging is blocked',
			sub: 'A person who knows this code has to sign off first. The review names who to ask.'
		},
		DANGEROUS: {
			title: 'Merge only after an expert review',
			sub: 'It touches timing, interrupts, hardware registers, external interfaces or code with a bug-fix history.'
		},
		RISKY: {
			title: 'Merge with care',
			sub: "Part of what it touches can't be traced completely, or has no related tests."
		},
		SAFE: {
			title: 'Safe to merge',
			sub: 'Behaviour-free, or fully traced with related tests found.'
		}
	};

	/** Everyone the findings point at, once each. */
	const people = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built once per derivation
		const seen = new Map<string, Person>();
		for (const f of r?.findings ?? [])
			if (f.ask && !seen.has(f.ask.email)) seen.set(f.ask.email, f.ask);
		return [...seen.values()];
	});

	async function runAgain() {
		const res = await apiFetch('/api/reviews', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ repo: review.repo, pr_number: review.prNumber })
		});
		const body = await res.json().catch(() => null);
		if (!res.ok) {
			toast.error('Could not start the review', { description: body?.message ?? res.statusText });
			return;
		}
		await goto(resolve(`/scans/${data.scan.id}/pulls/${body.review_id}`));
	}
</script>

<svelte:head><title>{review.title} · {review.repo}#{review.prNumber}</title></svelte:head>

{#snippet event(icon: typeof CheckIcon, tone: string)}
	{@const Icon = icon}
	<span
		class={cn(
			'relative z-10 grid size-8 place-items-center rounded-full ring-4 ring-background',
			tone
		)}
	>
		<Icon class="size-4" />
	</span>
{/snippet}

<div class="mx-auto max-w-6xl px-4 pt-6 pb-48 sm:px-8">
	<a
		href={resolve(`/scans/${data.scan.id}/pulls`)}
		class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
	>
		<ArrowLeftIcon class="size-3.5" /> Pull requests
	</a>

	<header class="mt-3 border-b border-border pb-5">
		<h1 class="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-pretty">
			{review.title}
			<span class="font-normal text-muted-foreground">#{review.prNumber}</span>
		</h1>
		{#if r}
			<div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
				<span
					class={cn(
						'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-white',
						r.pull.merged
							? 'bg-pr-merged'
							: r.pull.state === 'closed'
								? 'bg-pr-closed'
								: 'bg-pr-open'
					)}
				>
					<PullStateIcon state={r.pull.state} merged={r.pull.merged} class="size-3.5 text-white" />
					{r.pull.merged ? 'Merged' : r.pull.state === 'closed' ? 'Closed' : 'Open'}
				</span>
				<span class="text-muted-foreground">
					<strong class="font-semibold text-foreground">{r.pull.author}</strong>
					{r.pull.merged ? 'merged' : 'wants to merge'} into
					<code class="rounded bg-link/10 px-1.5 py-0.5 font-sans text-[11.5px] text-link"
						>{r.pull.baseRef}</code
					>
					from
					<code class="rounded bg-link/10 px-1.5 py-0.5 font-sans text-[11.5px] text-link"
						>{r.pull.headRef}</code
					>
				</span>
				<!-- eslint-disable svelte/no-navigation-without-resolve -- GitHub URL, not an app route -->
				<a
					href={r.pull.url}
					target="_blank"
					rel="noreferrer"
					class="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
				>
					View on GitHub <ExternalLinkIcon class="size-3" />
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</div>
		{:else}
			<p class="mt-2 text-xs text-muted-foreground">{review.repo}#{review.prNumber}</p>
		{/if}
	</header>

	{#if running}
		<section
			class="mt-8 max-w-3xl overflow-hidden rounded-xl ring-1 ring-border"
			aria-live="polite"
		>
			<div class="flex items-center gap-3 bg-card p-4">
				<span class="grid size-9 place-items-center rounded-full bg-link/10 text-link">
					<Loader2Icon class="size-4.5 animate-spin" />
				</span>
				<div>
					<p class="text-sm font-semibold">Reviewing</p>
					<p class="text-xs text-muted-foreground">{review.stage ?? 'Waiting in the queue'}</p>
				</div>
			</div>
			<p class="border-t border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
				Usually takes about ten seconds.
			</p>
		</section>
	{:else if review.status === 'failed' || !r || !verdict}
		<section class="mt-8 max-w-3xl rounded-xl bg-destructive/5 p-5 ring-1 ring-destructive/25">
			<p class="flex items-center gap-2 text-sm font-medium text-destructive">
				<CircleXIcon class="size-4" /> The review failed
			</p>
			<p class="mt-2 text-[13px] text-foreground/90">{review.error ?? 'No result was stored.'}</p>
			<Button variant="outline" size="sm" class="mt-4 pressable" onclick={runAgain}>
				<RefreshCwIcon /> Run it again
			</Button>
		</section>
	{:else}
		{@const style = VERDICT[verdict]}
		<Tabs.Root bind:value={tab} class="mt-4">
			<Tabs.List variant="line" class="h-9">
				<Tabs.Trigger value="conversation" class="px-3 text-[13px]">Conversation</Tabs.Trigger>
				<Tabs.Trigger value="files" class="gap-1.5 px-3 text-[13px]">
					Files changed
					<span class="rounded-full bg-muted px-1.5 text-[10.5px] text-muted-foreground"
						>{r.stats.files}</span
					>
				</Tabs.Trigger>
			</Tabs.List>

			<div class="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem]">
				<div class="min-w-0">
					<Tabs.Content value="conversation">
						<ol class="relative grid">
							<span class="absolute top-4 bottom-0 left-4 w-px bg-border" aria-hidden="true"></span>

							<!-- The review itself -->
							<li class="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-8">
								<span
									class="relative z-10 grid size-8 place-items-center rounded-full bg-card ring-1 ring-border outline-4 outline-background"
								>
									<LogoMark class="size-5" />
								</span>
								<div class="min-w-0 overflow-hidden rounded-xl bg-card ring-1 ring-border">
									<div
										class="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-[13px]"
									>
										<strong class="font-semibold">undefined</strong>
										<span class="text-muted-foreground">{reviewed[verdict]}</span>
										<VerdictChip {verdict} />
										<span class="ml-auto text-xs text-muted-foreground"
											>{ago(review.finishedAt ?? review.createdAt)}</span
										>
									</div>
									<div class="grid gap-4 p-4">
										<p class="text-[14px] leading-relaxed text-pretty">{r.rationale.text}</p>
										<p class="text-[11.5px] text-muted-foreground">
											{r.rationale.source === 'llm'
												? `Written by ${r.llm.model} from the evidence below.`
												: 'From the deterministic rules.'}
											{#if r.llm.used && r.llm.downgrades}
												{plural(r.llm.downgrades, 'model claim')} downgraded by the validator.
											{/if}
											{#if r.llm.error}Model step skipped: {r.llm.error}{/if}
										</p>
										{#if r.findings.length}
											<div class="grid gap-3">
												{#each r.findings as f, i (i)}
													<article
														class={cn(
															'rounded-lg ring-1 ring-border',
															f.severity !== 'INFO' && VERDICT[f.severity].ring
														)}
													>
														<header
															class="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2"
														>
															{#if f.severity !== 'INFO'}<VerdictChip verdict={f.severity} />{/if}
															<h3 class="min-w-0 flex-1 text-[13px] font-semibold">{f.title}</h3>
															{#if f.ask}<AskAuthor person={f.ask} repo={review.repo} />{/if}
														</header>
														<div class="p-3">
															<ClaimList claims={f.claims} repo={review.repo} />
														</div>
													</article>
												{/each}
											</div>
										{/if}
									</div>
								</div>
							</li>

							<!-- Blast radius -->
							<li class="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-8">
								{@render event(OrbitIcon, 'bg-muted text-muted-foreground')}
								<div class="min-w-0">
									<h2 class="pt-1.5 text-[13px] font-semibold">Blast radius</h2>
									<p class="mt-0.5 text-xs text-muted-foreground">
										What depends on the touched code.
									</p>
									<div class="mt-3 grid gap-3 rounded-xl bg-card p-3 ring-1 ring-border">
										{#if r.touched.length}
											<ImpactGraph result={r} number={review.prNumber} />
										{/if}
										<dl class="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
											{#each [['touched', r.touched.length], ['dependents', r.impact.nodes.length], ['uncertain links', r.impact.counts.ambiguous + r.impact.counts.unresolved], ['outside scope', r.impact.counts.boundary]] as [label, n] (label)}
												<div class="rounded-lg bg-muted/60 px-2 py-2">
													<dd class="text-sm font-medium tabular-nums">
														{num(n as number)}
													</dd>
													<dt class="text-[10.5px] text-muted-foreground">{label}</dt>
												</div>
											{/each}
										</dl>
										{#if r.touched.length}
											<ul class="grid gap-1 text-[12px]">
												{#each r.touched as t (t.id)}
													<li class="flex items-center gap-2">
														<span class="size-1.5 shrink-0 rounded-full bg-link"></span>
														<span class="min-w-0 truncate">{t.name}</span>
														<span class="shrink-0 text-[11px] text-muted-foreground">
															{t.side === 'head' ? 'added' : `${t.level} criticality`}
														</span>
													</li>
												{/each}
											</ul>
										{/if}
									</div>
								</div>
							</li>

							<!-- Tests -->
							<li class="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-8">
								{@render event(FlaskConicalIcon, 'bg-muted text-muted-foreground')}
								<div class="min-w-0 pt-1.5">
									<h2 class="text-[13px] font-semibold">Tests</h2>
									<p class="mt-0.5 text-xs text-muted-foreground">{r.tests.note}</p>
									<div class="mt-3 grid gap-3 text-[12.5px]">
										{#if r.tests.related.length}
											<div>
												<p class="mb-1 font-medium">Related tests found</p>
												<ul class="grid gap-0.5">
													{#each r.tests.related as t (t.path)}
														<li class="text-[11.5px]">
															{t.path}
															<span class="text-muted-foreground">{t.symbols.join(', ')}</span>
														</li>
													{/each}
												</ul>
											</div>
										{/if}
										{#if r.tests.missing.length}
											<div>
												<p class="mb-1 font-medium">No related test for</p>
												<ul class="flex flex-wrap gap-1">
													{#each r.tests.missing as m (m)}
														<li
															class="rounded-sm bg-risky/10 px-1.5 py-0.5 text-[11px] text-risky ring-1 ring-risky/25 ring-inset"
														>
															{m}
														</li>
													{/each}
												</ul>
												<p class="mt-2 text-xs text-muted-foreground">
													Suggested: a characterization test that pins the current behaviour of
													these functions, timing included, before merging.
												</p>
											</div>
										{:else if !r.tests.related.length}
											<p class="text-xs text-muted-foreground">
												No critical code touched that needs a test.
											</p>
										{/if}
									</div>
								</div>
							</li>

							{#if r.assumptions.length}
								<li class="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-8">
									{@render event(TimerIcon, 'bg-dangerous/10 text-dangerous')}
									<div class="min-w-0 pt-1.5">
										<h2 class="mb-3 text-[13px] font-semibold">
											Unwritten assumptions this PR may break
										</h2>
										<ClaimList claims={r.assumptions} repo={review.repo} />
									</div>
								</li>
							{/if}

							{#if r.openQuestions.length}
								<li class="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-8">
									{@render event(MessageCircleQuestionIcon, 'bg-muted text-muted-foreground')}
									<div class="min-w-0 pt-1.5">
										<h2 class="text-[13px] font-semibold">Open questions</h2>
										<p class="mt-0.5 mb-3 text-xs text-muted-foreground">
											What the code and history can't answer. Ask a person.
										</p>
										<ClaimList claims={r.openQuestions} repo={review.repo} />
									</div>
								</li>
							{/if}

							{#each review.overrides as o, i (i)}
								<li class="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-8">
									{@render event(UserRoundPenIcon, 'bg-link/10 text-link')}
									<div class="min-w-0 pt-1.5 text-[13px]">
										<p>
											<strong class="font-semibold">{o.user}</strong>
											<span class="text-muted-foreground">overrode the verdict to</span>
											<VerdictChip verdict={o.verdict} class="mx-1 align-middle" />
											<span class="text-xs text-muted-foreground">{ago(o.at)}</span>
										</p>
										<blockquote
											class="mt-2 rounded-lg bg-card px-3 py-2 text-[13px] ring-1 ring-border"
										>
											{o.reason}
										</blockquote>
									</div>
								</li>
							{/each}

							<!-- Merge box -->
							<li class="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
								{@render event(style.icon, cn(style.bg, style.text))}
								<section class="min-w-0 overflow-hidden rounded-xl bg-card ring-1 ring-border">
									<div class={cn('flex gap-3 border-b border-border p-4', style.bg)}>
										<div>
											<p class={cn('text-sm font-semibold', style.text)}>{merge[verdict].title}</p>
											<p class="mt-0.5 text-xs text-muted-foreground">{merge[verdict].sub}</p>
										</div>
									</div>
									<ul class="divide-y divide-border/70">
										{#each r.floorReasons as h, i (i)}
											{@const s = VERDICT[h.verdict]}
											<li class="flex items-start gap-2.5 px-4 py-2.5 text-[12.5px]">
												<s.icon class={cn('mt-0.5 size-3.5 shrink-0', s.text)} />
												<span class="min-w-0 flex-1">{h.detail}</span>
												<VerdictChip verdict={h.verdict} />
											</li>
										{/each}
										<li class="flex items-start gap-2.5 px-4 py-2.5 text-[12.5px]">
											{#if r.completeness.level === 'complete'}
												<CircleCheckIcon class="mt-0.5 size-3.5 shrink-0 text-safe" />
											{:else}
												<CircleAlertIcon class="mt-0.5 size-3.5 shrink-0 text-risky" />
											{/if}
											<span class="min-w-0 flex-1">
												Analysis is {r.completeness.level}{r.completeness.reasons.length
													? `: ${r.completeness.reasons[0]}`
													: '.'}
											</span>
										</li>
										<li class="flex items-start gap-2.5 px-4 py-2.5 text-[12.5px]">
											{#if r.tests.missing.length}
												<CircleAlertIcon class="mt-0.5 size-3.5 shrink-0 text-risky" />
												<span
													>No related test for {plural(
														r.tests.missing.length,
														'critical function'
													)}.</span
												>
											{:else}
												<CircleCheckIcon class="mt-0.5 size-3.5 shrink-0 text-safe" />
												<span>No critical function left without a related test.</span>
											{/if}
										</li>
									</ul>
									<div
										class="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3"
									>
										<p class="text-xs text-muted-foreground">
											Only a person can move the verdict below the rule floor.
										</p>
										<Button
											variant="outline"
											size="sm"
											class="pressable"
											onclick={() => (overrideOpen = true)}
										>
											<ShieldAlertIcon />
											Override verdict
										</Button>
									</div>
								</section>
							</li>
						</ol>
					</Tabs.Content>

					<Tabs.Content value="files">
						{#if r.diff?.length}
							<DiffView
								files={r.diff}
								classes={r.changeClass.files}
								findings={r.findings}
								snapshots={r.snapshots}
								repo={review.repo}
							/>
						{:else}
							<div class="rounded-xl bg-card p-6 text-center ring-1 ring-border">
								<p class="text-sm">This review was stored before diffs were kept.</p>
								<Button variant="outline" size="sm" class="mt-3 pressable" onclick={runAgain}>
									<RefreshCwIcon /> Run it again to see the diff
								</Button>
							</div>
						{/if}
					</Tabs.Content>
				</div>

				<aside class="grid content-start gap-5 text-[12px] lg:sticky lg:top-20">
					<section>
						<h3 class="mb-2 text-xs font-semibold text-muted-foreground">Verdict</h3>
						<div class="grid gap-1.5">
							<p class="flex items-center gap-2"><VerdictChip {verdict} /></p>
							<p class="text-muted-foreground">
								Rule floor <VerdictChip verdict={r.floor} class="ml-1 align-middle" />
							</p>
							{#if r.verdict !== r.floor}
								<p class="text-muted-foreground">
									Raised by the model to <VerdictChip
										verdict={r.verdict}
										class="ml-1 align-middle"
									/>
								</p>
							{/if}
						</div>
					</section>
					<section>
						<h3 class="mb-2 text-xs font-semibold text-muted-foreground">Change</h3>
						<ul class="flex flex-wrap gap-1">
							{#each [...new Set(r.changeClass.files.map((f) => f.class))] as c (c)}
								<li
									class={cn(
										'rounded-sm px-1.5 py-0.5 text-[10.5px] ring-1 ring-inset',
										CHANGE_CLASS[c].behaviourFree
											? 'bg-safe/10 text-safe ring-safe/25'
											: 'bg-muted text-muted-foreground ring-border'
									)}
								>
									{CHANGE_CLASS[c].label}
								</li>
							{/each}
						</ul>
						<p class="mt-2 text-muted-foreground">
							{plural(r.stats.files, 'file')}, {plural(r.stats.hunks, 'hunk')}. Reviewed in {(
								r.stats.ms / 1000
							).toFixed(1)} s{r.llm.tokens ? `, ${num(r.llm.tokens)} tokens` : ''}.
						</p>
					</section>
					{#if people.length}
						<section>
							<h3 class="mb-2 text-xs font-semibold text-muted-foreground">Ask</h3>
							<ul class="grid gap-1.5">
								{#each people as p (p.email)}
									<li><AskAuthor person={p} repo={review.repo} /></li>
								{/each}
							</ul>
						</section>
					{/if}
					<section>
						<h3 class="mb-2 text-xs font-semibold text-muted-foreground">Completeness</h3>
						<p class="font-medium capitalize">{r.completeness.level}</p>
						{#if r.completeness.reasons.length}
							<ul class="mt-1 grid gap-1 text-muted-foreground">
								{#each r.completeness.reasons as reason (reason)}<li>{reason}</li>{/each}
							</ul>
						{/if}
					</section>
					<section>
						<h3 class="mb-2 text-xs font-semibold text-muted-foreground">Pinned snapshots</h3>
						<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
							{#each [['Merge base', r.snapshots.mergeBase], ['Base', r.snapshots.base], ['Head', r.snapshots.head]] as [label, sha] (label)}
								<dt class="text-muted-foreground">{label}</dt>
								<dd>
									<a
										class="text-link hover:underline"
										href="https://github.com/{review.repo}/commit/{sha}"
										target="_blank"
										rel="noreferrer">{shortSha(sha, 10)}</a
									>
								</dd>
							{/each}
						</dl>
						{#if r.snapshots.mergeBaseDiffers}
							<p class="mt-2 text-risky">
								The base branch moved since the PR branched. Findings refer to the merge base.
							</p>
						{/if}
					</section>
					<section>
						<h3 class="mb-2 text-xs font-semibold text-muted-foreground">Scope</h3>
						<p class="flex items-center gap-1.5 text-[11.5px]">
							<GitBranchIcon class="size-3 text-muted-foreground" />
							{r.scope.deepScope || 'Entire repository'}
						</p>
						{#if r.scope.fromScan}
							<a
								href={resolve(`/scans/${r.scope.fromScan}/overview`)}
								class="mt-1 inline-block text-link hover:underline">From your scan</a
							>
						{/if}
					</section>
				</aside>
			</div>
		</Tabs.Root>

		<OverrideDialog reviewId={review.id} floor={r.floor} bind:open={overrideOpen} />
	{/if}
</div>
