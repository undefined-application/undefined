<script lang="ts">
	// The chat about a system, in one of two places (docs/ui-spec.md §4.4):
	// - the dock: a DeepWiki-style composer at the bottom of every system page; asking grows the
	//   thread upward out of it, Esc or the chevron folds it back;
	// - the side panel (`panel`): a column next to the page on wide screens, the thread always open.
	// Selecting text in a message quotes it into the next question.
	// The header's title opens every conversation about this system, and starts a new one.
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
	import PanelRightCloseIcon from '@lucide/svelte/icons/panel-right-close';
	import PanelRightOpenIcon from '@lucide/svelte/icons/panel-right-open';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import SquarePenIcon from '@lucide/svelte/icons/square-pen';
	import TextQuoteIcon from '@lucide/svelte/icons/text-quote';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { tick, untrack } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import ClaimList from '$lib/components/ClaimList.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import { chatPanel, nav } from '$lib/components/shell.svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { ago, plural } from '$lib/format';
	import type { ScanSummary } from '$lib/scan';
	import { cn } from '$lib/utils';
	import { threadFor, titleOf, type Conversation, type Quote } from './thread.svelte';

	interface Props {
		scan: ScanSummary;
		llmEnabled: boolean;
		/** Render as the side panel instead of the dock. */
		panel?: boolean;
	}

	let { scan, llmEnabled, panel = false }: Props = $props();

	const thread = $derived(threadFor(scan.id));
	const scope = $derived(scan.deepScope ? scan.deepScope.split('/').pop()! : scan.repo);
	const ready = $derived(scan.status === 'done' && llmEnabled);
	const placeholder = $derived(
		!llmEnabled
			? 'Chat is off: no model configured'
			: scan.status !== 'done'
				? 'Chat opens when the scan finishes'
				: `Ask about ${scope}…`
	);

	const starters = $derived([
		'What are the timing-critical paths?',
		'Which functions carry hardware workarounds?',
		...(scan.repo === 'ArduPilot/ardupilot'
			? ['Why does the Invensense driver compare temperatures before accepting FIFO data?']
			: []),
		'What breaks if we replace the sensor chip?',
		'Where should a new maintainer start reading?'
	]);

	// While the agent works (one request, no streaming), step through what it is likely doing, then
	// stay on the last step: never loop back, so it reads as progress, not a canned rotation.
	const THINKING = [
		'Thinking…',
		'Looking through the code…',
		'Reading the history…',
		'Weighing the evidence…',
		'Checking the answer…',
		'Writing the answer…'
	];
	let thinking = $state(0);
	$effect(() => {
		if (!thread.sending) return;
		thinking = 0;
		const timer = setInterval(() => {
			if (thinking < THINKING.length - 1) thinking++;
		}, 4000);
		return () => clearInterval(timer);
	});

	let menuOpen = $state(false);
	/** The conversation waiting for a confirmed delete. */
	let toDelete = $state<Conversation | null>(null);
	let confirmOpen = $state(false);

	let card = $state<HTMLDivElement>();
	let textarea = $state<HTMLTextAreaElement>();
	let scroller = $state<HTMLDivElement>();
	let focused = $state(false);
	/** The dock's thread; the side panel always shows it. */
	const shown = $derived(thread.open && thread.messages.length > 0);

	/**
	 * Move the chat between the dock and the side panel (`open: false` minimises it into the dock),
	 * keeping the composer focused. The box flies over as a view transition (both places share the
	 * `chat` transition name, see layout.css); browsers without view transitions just switch.
	 */
	function toPanel(split: boolean, open = true) {
		const swap = () => {
			chatPanel.set(split);
			thread.open = open;
		};
		// Focusing the composer would unfold a minimised thread again.
		const focus = () => open && thread.focus();
		if (!document.startViewTransition || prefersReducedMotion.current) {
			swap();
			// After the new instance has mounted, so the request reaches it.
			tick().then(focus);
			return;
		}
		document
			.startViewTransition(async () => {
				swap();
				await tick();
			})
			.finished.finally(focus);
	}

	function grow() {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
	}

	async function submit(e?: Event) {
		e?.preventDefault();
		if (!ready) return;
		const sent = thread.send();
		await tick();
		grow();
		await sent;
	}

	// Keep the newest message in view: glide to a new message, but open (or move) the thread already
	// at the bottom instead of scrolling through all of it.
	let seen = -1;
	$effect(() => {
		const count = thread.messages.length + (thread.sending ? 1 : 0);
		if ((!panel && !thread.open) || !scroller) {
			seen = -1;
			return;
		}
		const glide = seen >= 0 && count !== seen && !prefersReducedMotion.current;
		seen = count;
		tick().then(() =>
			scroller?.scrollTo({ top: scroller.scrollHeight, behavior: glide ? 'smooth' : 'instant' })
		);
	});

	// Other parts of the page ask the composer to take focus ("Ask about this node"). Only requests
	// made while this instance is mounted count: a dock appearing after a minimise must not focus
	// itself (and so unfold the thread) because of a request meant for the side panel before it.
	let focusHandled = untrack(() => thread.focusRequest);
	$effect(() => {
		const request = thread.focusRequest;
		if (request === focusHandled) return;
		focusHandled = request;
		textarea?.focus();
	});

	// The floating "Quote" button over a text selection inside one message.
	type Selected = { text: string; from: Quote['from']; x: number; y: number; below: boolean };
	let selection = $state<Selected | null>(null);
	// Shown once the drag ends, so it doesn't chase the pointer while the selection grows.
	let pointerDown = false;

	const quoteHost = (node: Node | null) =>
		(node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>(
			'[data-quote-from]'
		) ?? null;

	function readSelection() {
		const sel = window.getSelection();
		if (pointerDown || !sel || sel.isCollapsed || !sel.rangeCount || !card || !scroller)
			return (selection = null);
		const host = quoteHost(sel.anchorNode);
		const text = sel.toString().trim();
		if (!host || host !== quoteHost(sel.focusNode) || !scroller.contains(host) || !text)
			return (selection = null);
		const range = sel.getRangeAt(0).getBoundingClientRect();
		const box = card.getBoundingClientRect();
		const view = scroller.getBoundingClientRect();
		if (range.bottom < view.top || range.top > view.bottom) return (selection = null);
		// Above the selection, or below it when there is no room under the card's top edge.
		const below = range.top - box.top < 44;
		selection = {
			text,
			from: host.dataset.quoteFrom as Quote['from'],
			x: Math.min(Math.max(range.left + range.width / 2 - box.left, 56), box.width - 56),
			y: below ? range.bottom - box.top + 6 : range.top - box.top - 6,
			below
		};
	}

	function quoteSelection() {
		if (!selection) return;
		thread.quoteText(selection.text, selection.from);
		window.getSelection()?.removeAllRanges();
		selection = null;
	}

	function onWindowKey(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		const typing = target.closest('input, textarea, [contenteditable="true"]');
		if (e.key === '/' && !typing && ready) {
			e.preventDefault();
			textarea?.focus();
		}
	}
</script>

<svelte:window onkeydown={onWindowKey} />
<svelte:document
	onselectionchange={readSelection}
	onpointerdown={() => (pointerDown = true)}
	onpointerup={() => {
		pointerDown = false;
		readSelection();
	}}
/>

{#snippet header()}
	<div
		class={cn(
			'flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-2',
			panel ? 'h-11' : 'py-1.5'
		)}
	>
		<DropdownMenu.Root bind:open={menuOpen}>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						class="flex min-w-0 pressable items-center gap-2 rounded-md px-1.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
						title="Conversations"
					>
						<MessagesSquareIcon class="size-3.5 shrink-0 text-muted-foreground" />
						<span class="truncate"
							>{thread.active ? titleOf(thread.active) : 'New conversation'}</span
						>
						<ChevronsUpDownIcon class="size-3.5 shrink-0 text-muted-foreground" />
					</button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start" class="w-80 max-w-[calc(100vw-2rem)]">
				<DropdownMenu.Item onSelect={() => thread.startNew()} disabled={!thread.active}>
					<SquarePenIcon />
					New conversation
				</DropdownMenu.Item>
				{#if thread.conversations.length}
					<DropdownMenu.Separator />
					<DropdownMenu.Label class="text-[11px] font-normal text-muted-foreground">
						Conversations about {scope}
					</DropdownMenu.Label>
					<div class="max-h-80 scrollbar-thin overflow-y-auto">
						{#each thread.conversations as c (c.id)}
							<DropdownMenu.Item
								class="group/conv items-start gap-2"
								onSelect={() => thread.select(c.id)}
							>
								<CheckIcon class={cn('mt-0.5 shrink-0', c.id !== thread.activeId && 'invisible')} />
								<span class="min-w-0 flex-1">
									<span class="block truncate text-[12.5px]">{titleOf(c)}</span>
									<span class="block text-[11px] text-muted-foreground tabular-nums">
										{ago(new Date(c.updatedAt).toISOString())} · {plural(
											c.messages.filter((m) => m.role === 'user').length,
											'question'
										)}
									</span>
								</span>
								<button
									type="button"
									class="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover/conv:opacity-100 group-focus/conv:opacity-100 hover:text-destructive focus-visible:opacity-100 disabled:hidden"
									disabled={thread.pending === c.id}
									aria-label="Delete conversation"
									title="Delete conversation"
									onpointerdown={(e) => e.stopPropagation()}
									onclick={(e) => {
										e.stopPropagation();
										e.preventDefault();
										menuOpen = false;
										toDelete = c;
										confirmOpen = true;
									}}
								>
									<Trash2Icon class="size-3.5" />
								</button>
							</DropdownMenu.Item>
						{/each}
					</div>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<div class="flex shrink-0 items-center gap-0.5">
			{#if panel}
				<Button
					variant="ghost"
					size="icon-sm"
					class="text-muted-foreground"
					onclick={() => toPanel(false)}
					aria-label="Dock at the bottom"
					title="Dock at the bottom"
				>
					<PanelRightCloseIcon />
				</Button>
			{:else if chatPanel.available}
				<Button
					variant="ghost"
					size="icon-sm"
					class="text-muted-foreground"
					onclick={() => toPanel(true)}
					aria-label="Open as side panel"
					title="Open as side panel"
				>
					<PanelRightOpenIcon />
				</Button>
			{/if}
			<Button
				variant="ghost"
				size="icon-sm"
				onclick={() => (panel ? toPanel(false, false) : (thread.open = false))}
				aria-label="Minimise"
				title="Minimise"
			>
				<ChevronDownIcon />
			</Button>
		</div>
	</div>
{/snippet}

{#snippet messages()}
	{#each thread.messages as m, i (i)}
		{#if m.role === 'user'}
			<div class="flex items-start justify-end">
				<div
					class="max-w-[85%] min-w-0 rounded-xl rounded-br-sm bg-muted px-3 py-2 text-[13px] leading-relaxed"
					data-quote-from="user"
				>
					{#if m.quote}
						<p
							class="mb-1.5 line-clamp-3 border-l-2 border-foreground/20 pl-2 text-[12px] whitespace-pre-line text-muted-foreground"
						>
							{m.quote.text}
						</p>
					{/if}
					<p class="whitespace-pre-wrap">{m.content}</p>
				</div>
			</div>
		{:else}
			<div class="min-w-0 space-y-3">
				{#if m.error}
					<p class="text-[13px] text-destructive">{m.content}</p>
					{#if i === thread.messages.length - 1}
						<Button variant="outline" size="sm" onclick={() => thread.retry()}>
							<RotateCcwIcon />
							Try again
						</Button>
					{/if}
				{:else}
					<div class="space-y-3" data-quote-from="assistant">
						<Markdown text={m.content} class="text-[13.5px] leading-relaxed text-foreground" />
						{#if m.claims?.length}
							<ClaimList claims={m.claims} repo={scan.repo} />
						{/if}
					</div>
					{#if m.steps?.length}
						<details class="group text-[11.5px] text-muted-foreground">
							<summary
								class="cursor-pointer list-none select-none hover:text-foreground [&::-webkit-details-marker]:hidden"
							>
								Looked up {m.steps.length}
								{m.steps.length === 1 ? 'thing' : 'things'} in the model{m.downgrades
									? `, ${m.downgrades} claim${m.downgrades === 1 ? '' : 's'} downgraded by the validator`
									: ''}
							</summary>
							<ul class="mt-1.5 space-y-0.5 text-[11px]">
								{#each m.steps as s, j (j)}
									<li class="truncate">
										{s.tool}
										<span class="text-muted-foreground/70">{JSON.stringify(s.args)}</span>
									</li>
								{/each}
							</ul>
						</details>
					{/if}
				{/if}
			</div>
		{/if}
	{/each}
	{#if thread.sending}
		<div aria-live="polite">
			<div class="space-y-2">
				<span class="sr-only">Working on an answer</span>
				<p class="relative h-[18px] overflow-hidden text-[12px]" aria-hidden="true">
					{#key thinking}
						<span
							class="thinking absolute inset-x-0 truncate"
							in:fly={{ y: prefersReducedMotion.current ? 0 : 8, duration: 280 }}
							out:fly={{ y: prefersReducedMotion.current ? 0 : -8, duration: 280 }}
						>
							{THINKING[thinking]}
						</span>
					{/key}
				</p>
				<div class="h-2 w-3/4 animate-pulse rounded bg-muted"></div>
				<div class="h-2 w-1/2 animate-pulse rounded bg-muted"></div>
			</div>
		</div>
	{/if}
{/snippet}

{#snippet starterChips()}
	<div class="flex flex-wrap gap-1.5">
		{#each starters as q (q)}
			<button
				type="button"
				class="pressable rounded-full bg-muted px-2.5 py-1 text-left text-[11.5px] text-muted-foreground ring-1 ring-border transition-colors ring-inset hover:bg-accent hover:text-foreground"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => thread.send(q)}
			>
				{q}
			</button>
		{/each}
	</div>
{/snippet}

{#snippet composer()}
	{#if selection}
		<button
			type="button"
			class="absolute z-10 flex pressable items-center gap-1.5 rounded-lg bg-foreground px-2.5 py-1.5 text-[12px] font-medium text-background shadow-lg"
			style="left: {selection.x}px; top: {selection.y}px; transform: translate(-50%, {selection.below
				? '0'
				: '-100%'})"
			onmousedown={(e) => e.preventDefault()}
			onclick={quoteSelection}
		>
			<TextQuoteIcon class="size-3.5" />
			Quote
		</button>
	{/if}

	{#if thread.quote}
		<div class="flex items-start gap-2 border-b border-border/70 py-2 pr-2 pl-3">
			<TextQuoteIcon class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
			<div class="min-w-0 flex-1">
				<p class="text-[11px] text-muted-foreground">
					Replying to {thread.quote.from === 'assistant' ? 'the answer' : 'your message'}
				</p>
				<p class="line-clamp-2 text-[12px] whitespace-pre-line text-foreground/80">
					{thread.quote.text}
				</p>
			</div>
			<Button
				variant="ghost"
				size="icon-xs"
				onclick={() => (thread.quote = null)}
				aria-label="Remove quote"
				title="Remove quote"
			>
				<XIcon />
			</Button>
		</div>
	{/if}

	<form class="flex items-end gap-2 p-2" onsubmit={submit}>
		<textarea
			bind:this={textarea}
			bind:value={thread.draft}
			rows="1"
			{placeholder}
			disabled={!ready}
			aria-label="Question"
			class="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[13.5px] leading-snug outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
			oninput={grow}
			onfocus={() => {
				focused = true;
				if (thread.messages.length) thread.open = true;
			}}
			onblur={() => (focused = false)}
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) submit(e);
				if (e.key === 'Escape') {
					if (thread.quote) thread.quote = null;
					else {
						if (!panel) thread.open = false;
						textarea?.blur();
					}
				}
			}}></textarea>
		<div class="flex items-center gap-1.5 pb-1">
			<!-- With the thread open this sits in its header, next to Minimise. -->
			{#if !panel && !shown && chatPanel.available}
				<Button
					variant="ghost"
					size="icon-sm"
					class="text-muted-foreground"
					onclick={() => toPanel(true)}
					aria-label="Open as side panel"
					title="Open as side panel"
				>
					<PanelRightOpenIcon />
				</Button>
			{/if}
			<Button
				type="submit"
				size="icon"
				class="pressable rounded-lg"
				disabled={!ready || !thread.draft.trim() || thread.busy}
				aria-label="Ask"
			>
				<ArrowUpIcon />
			</Button>
		</div>
	</form>
{/snippet}

{#if panel}
	<div
		bind:this={card}
		class="relative flex h-full flex-col bg-background [view-transition-name:chat]"
		role="region"
		aria-label="Ask the codebase"
	>
		{@render header()}
		<div
			bind:this={scroller}
			onscroll={readSelection}
			class="min-h-0 flex-1 scrollbar-thin space-y-5 overflow-y-auto px-4 py-4"
		>
			{#if !thread.messages.length}
				<div class="space-y-4 pt-6">
					<p class="text-sm text-muted-foreground">
						Ask anything about {scope}. Every claim comes back cited and labelled.
					</p>
					{#if ready}{@render starterChips()}{/if}
				</div>
			{/if}
			{@render messages()}
		</div>
		<div class="shrink-0 border-t border-border/70">
			{@render composer()}
		</div>
	</div>
{:else}
	<!-- Centred on the page: clear of the sidebar, following it as it folds. -->
	<div
		class={cn(
			'pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-3 transition-[left] duration-220 ease-(--ease-sheet) sm:pb-5',
			nav.collapsed ? 'lg:left-0' : 'lg:left-60'
		)}
	>
		<div
			bind:this={card}
			class={cn(
				'pointer-events-auto relative w-full max-w-2xl overflow-hidden rounded-xl glass-card ring-1 ring-foreground/10 transition-shadow duration-300 [view-transition-name:chat]',
				'shadow-[0_16px_48px_-20px_rgb(28_25_23/0.45),0_2px_6px_-2px_rgb(28_25_23/0.12)]',
				focused && 'ring-foreground/20'
			)}
			role="region"
			aria-label="Ask the codebase"
		>
			<!-- The thread grows upward out of the composer; interruptible (a transition, not keyframes). -->
			<div
				class="grid transition-[grid-template-rows,opacity] duration-300 ease-(--ease-sheet)"
				style="grid-template-rows: {shown ? '1fr' : '0fr'}; opacity: {shown ? 1 : 0}"
				aria-hidden={!shown}
			>
				<div class="min-h-0 overflow-hidden">
					{@render header()}
					<div
						bind:this={scroller}
						onscroll={readSelection}
						class="max-h-[min(58vh,620px)] scrollbar-thin space-y-5 overflow-y-auto px-4 py-4"
					>
						{@render messages()}
					</div>
				</div>
			</div>

			{#if focused && ready && !thread.messages.length}
				<div class="border-b border-border/70 px-3 py-2.5">{@render starterChips()}</div>
			{/if}

			{@render composer()}
		</div>
	</div>
{/if}

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content class="sm:max-w-md">
		<AlertDialog.Header>
			<AlertDialog.Media class="bg-destructive/10 text-destructive">
				<Trash2Icon />
			</AlertDialog.Media>
			<AlertDialog.Title>Delete this conversation?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if toDelete}<span class="font-medium text-foreground">{titleOf(toDelete)}</span>
					and its answers are removed from this browser. It can't be undone.{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class={cn(buttonVariants({ variant: 'destructive' }), 'pressable')}
				onclick={() => {
					if (toDelete) thread.remove(toDelete.id);
					confirmOpen = false;
				}}
			>
				Delete conversation
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<style>
	/* A light sweeping across the working text, like a progress shimmer. */
	.thinking {
		color: transparent;
		background: linear-gradient(
				90deg,
				var(--muted-foreground) 0%,
				var(--muted-foreground) 40%,
				var(--foreground) 50%,
				var(--muted-foreground) 60%,
				var(--muted-foreground) 100%
			)
			0 0 / 250% 100%;
		background-clip: text;
		-webkit-background-clip: text;
		animation: thinking-sweep 2.4s linear infinite;
	}
	@keyframes thinking-sweep {
		from {
			background-position: 100% 0;
		}
		to {
			background-position: 0 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.thinking {
			animation: none;
			color: var(--muted-foreground);
			background: none;
		}
	}
</style>
