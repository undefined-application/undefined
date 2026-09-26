<script lang="ts">
	import { onMount } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fade, fly } from 'svelte/transition';
	import { apiFetch } from '$lib/api';
	import { toast } from 'svelte-sonner';
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ChatDock from '$lib/components/chat/ChatDock.svelte';
	import PanelResizer from '$lib/components/chat/PanelResizer.svelte';
	import DeleteRepoDialog from '$lib/components/scan/DeleteRepoDialog.svelte';
	import SystemNav from '$lib/components/scan/SystemNav.svelte';
	import { chatPanel, nav, shell } from '$lib/components/shell.svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import { cn } from '$lib/utils';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	/** Transition timings: none before the first paint settles, or with reduced motion. */
	const motion = (ms: number) => (shell.settled && !prefersReducedMotion.current ? ms : 0);

	// Poll while the job runs. TODO: SSE `/api/scans/{id}/events` (plan §6.2).
	const active = $derived(data.scan.status === 'queued' || data.scan.status === 'running');
	$effect(() => {
		if (!active) return;
		const timer = setInterval(() => invalidate('app:scan'), 1500);
		return () => clearInterval(timer);
	});

	// The chat side panel only after mount: the server can't know the screen width. A remembered
	// folded sidebar snaps shut then; it animates only from the next frame on.
	onMount(() => {
		shell.hydrated = true;
		requestAnimationFrame(() => requestAnimationFrame(() => (shell.settled = true)));
	});

	let deleteOpen = $state(false);
	let counts = $state({ scans: 1, reviews: 0 });

	async function rescan() {
		const s = data.scan;
		const res = await apiFetch('/api/scans', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				repo: s.repo,
				ref: s.ref,
				subpath: s.deepScope,
				reference_scope: s.referenceScope
			})
		});
		const body = await res.json().catch(() => null);
		if (!res.ok) {
			toast.error('Could not start the scan', { description: body?.message ?? res.statusText });
			return;
		}
		shell.navOpen = false;
		await goto(resolve(`/scans/${body.scan_id}/overview`));
	}

	/**
	 * A click on the sidebar's blank space does what its fold button does: docks it while it floats
	 * in, folds it away while docked. Links, buttons and selecting text (the commit, say) keep their
	 * own meaning.
	 */
	function toggleOnBlank(e: MouseEvent) {
		if (nav.collapsed && !shell.navPeek) return;
		if ((e.target as Element).closest('a, button, input, label, [role="button"]')) return;
		if (window.getSelection()?.toString()) return;
		nav.toggle();
	}

	async function askDelete() {
		// Name what will go before asking.
		const [scans, reviews] = await Promise.all([
			apiFetch('/api/scans').then((r) => (r.ok ? r.json() : [])),
			apiFetch('/api/reviews').then((r) => (r.ok ? r.json() : []))
		]);
		counts = {
			scans: (scans as { repo: string }[]).filter((s) => s.repo === data.scan.repo).length,
			reviews: (reviews as { repo: string }[]).filter((r) => r.repo === data.scan.repo).length
		};
		shell.navOpen = false;
		deleteOpen = true;
	}
</script>

<!-- The chat side panel is a third column. It switches at once: the chat box flies over as a view
	 transition and the page cross-fades, rather than text reflowing while a column grows. -->
<div
	class={cn(
		'lg:grid lg:grid-cols-[auto_minmax(0,1fr)]',
		chatPanel.open && 'lg:grid-cols-[auto_minmax(0,1fr)_var(--chat-width)]'
	)}
	style:--chat-width={chatPanel.open ? `${chatPanel.width}px` : undefined}
>
	<!-- The sidebar's room in the grid: this width is what animates as the sidebar folds. -->
	<div
		class={cn(
			'hidden lg:block',
			shell.settled &&
				'transition-[width] duration-220 ease-(--ease-sheet) motion-reduce:transition-none',
			nav.collapsed ? 'w-0' : 'w-60'
		)}
		aria-hidden="true"
	></div>

	<Sheet.Root bind:open={shell.navOpen}>
		<Sheet.Content side="left" class="w-72 bg-sidebar p-0">
			<Sheet.Title class="sr-only">System navigation</Sheet.Title>
			<SystemNav
				scan={data.scan}
				onnavigate={() => (shell.navOpen = false)}
				onrescan={rescan}
				ondelete={askDelete}
			/>
		</Sheet.Content>
	</Sheet.Root>

	<div class="min-w-0">
		{@render children()}
	</div>

	{#if chatPanel.open}
		<aside
			class="sticky top-12 hidden h-[calc(100dvh-3rem)] border-l border-border lg:block"
			aria-label="Chat"
		>
			<PanelResizer />
			<ChatDock scan={data.scan} llmEnabled={data.llmEnabled} panel />
		</aside>
	{/if}
</div>

{#if !chatPanel.open}
	<ChatDock scan={data.scan} llmEnabled={data.llmEnabled} />
{/if}

<!-- The sidebar (lg and up): docked in its room, or folded away and floating in while the pointer
	 is at the left edge, like a drawer. -->
{#if nav.collapsed}
	<!-- The left edge: hovering it shows the sidebar. The handle on it says the sidebar is there
		 (it slides in once the sidebar has left, and steps aside while the sidebar floats in); a
		 click docks the sidebar again. -->
	<div
		class="group/edge fixed top-12 bottom-0 left-0 z-30 hidden w-2.5 lg:block"
		role="presentation"
		onmouseenter={() => nav.peek(true)}
		onmouseleave={() => nav.peek(false)}
		in:fly={{ x: -16, duration: motion(220), delay: motion(140), easing: cubicOut }}
		out:fade={{ duration: motion(100) }}
	>
		<button
			type="button"
			class={cn(
				'absolute top-1/2 left-0 flex h-14 w-3.5 -translate-y-1/2 items-center justify-center rounded-r-lg glass-card shadow-sm ring-1 ring-foreground/10 transition-[width,opacity,translate] duration-220 ease-(--ease-sheet) outline-none group-hover/edge:w-4.5 focus-visible:w-4.5 focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none',
				shell.navPeek && 'pointer-events-none -translate-x-full opacity-0'
			)}
			onclick={() => nav.toggle()}
			aria-label="Show the sidebar"
			title="Show the sidebar"
		>
			<span
				class="h-6 w-0.5 rounded-full bg-muted-foreground/50 transition-colors group-hover/edge:bg-foreground/70"
				aria-hidden="true"
			></span>
		</button>
	</div>
{/if}
<!-- Clicking its blank space is a pointer shortcut; the fold button does the same from the keyboard. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<aside
	class={cn(
		'fixed z-30 hidden w-60 lg:block',
		shell.settled &&
			'transition-[translate,opacity,top,bottom,left,border-radius,box-shadow] duration-220 ease-(--ease-sheet) motion-reduce:transition-none',
		nav.collapsed
			? 'top-14 bottom-2 left-2 overflow-hidden rounded-xl glass-card shadow-xl ring-1 ring-foreground/10'
			: 'top-12 bottom-0 left-0 border-r border-sidebar-border bg-sidebar',
		nav.collapsed && !shell.navPeek && '-translate-x-[calc(100%+2rem)] opacity-0'
	)}
	inert={nav.collapsed && !shell.navPeek}
	onmouseenter={() => nav.peek(true)}
	onmouseleave={() => nav.peek(false)}
	onclick={toggleOnBlank}
>
	<SystemNav scan={data.scan} foldable onrescan={rescan} ondelete={askDelete} />
</aside>

<DeleteRepoDialog
	repo={data.scan.repo}
	scans={counts.scans}
	reviews={counts.reviews}
	bind:open={deleteOpen}
	ondeleted={() => goto(resolve('/'))}
/>
