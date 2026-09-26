<script lang="ts">
	import PanelLeftIcon from '@lucide/svelte/icons/panel-left';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Logo from '$lib/components/brand/Logo.svelte';
	import { shell } from '$lib/components/shell.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import UserMenu from '$lib/components/UserMenu.svelte';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb';
	import { Button } from '$lib/components/ui/button';
	import type { ReviewSummary } from '$lib/review';
	import type { ScanSummary } from '$lib/scan';

	interface Props {
		user: { name: string; email: string; image?: string | null };
	}

	let { user }: Props = $props();

	interface Crumb {
		label: string;
		href?: string;
	}

	const scan = $derived(page.data.scan as ScanSummary | undefined);
	const review = $derived(page.data.review as ReviewSummary | undefined);
	/** Where you are inside a system; empty on the systems list. */
	const crumbs = $derived.by((): Crumb[] => {
		if (!scan) return [];
		const scope = scan.deepScope ? scan.deepScope.split('/').pop()! : 'whole repo';
		if (!review)
			return [{ label: scan.repo, href: resolve(`/scans/${scan.id}/overview`) }, { label: scope }];
		return [
			{ label: scan.repo, href: resolve(`/scans/${scan.id}/overview`) },
			{ label: 'Pull requests', href: resolve(`/scans/${scan.id}/pulls`) },
			{ label: `#${review.prNumber}` }
		];
	});
</script>

<header class="sticky top-0 z-40 border-b border-border/70 glass">
	<div class="grid h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 sm:gap-3 sm:px-4">
		<div class="flex min-w-0 items-center gap-2 sm:gap-3">
			{#if scan}
				<Button
					variant="ghost"
					size="icon-sm"
					class="lg:hidden"
					aria-label="Open navigation"
					onclick={() => (shell.navOpen = true)}
				>
					<PanelLeftIcon />
				</Button>
			{/if}
			<a
				href={resolve('/')}
				class="-mx-1 shrink-0 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
				aria-label="undefined, all systems"
			>
				<Logo />
			</a>

			{#if crumbs.length}
				<span class="h-4 w-px shrink-0 bg-border max-sm:hidden" aria-hidden="true"></span>
				<Breadcrumb.Root class="min-w-0 max-sm:hidden">
					<Breadcrumb.List class="flex-nowrap text-xs">
						{#each crumbs as crumb, i (i)}
							{#if i > 0}<Breadcrumb.Separator />{/if}
							<Breadcrumb.Item class="min-w-0">
								{#if crumb.href}
									<Breadcrumb.Link href={crumb.href} class="truncate">
										{crumb.label}
									</Breadcrumb.Link>
								{:else}
									<Breadcrumb.Page class="truncate">
										{crumb.label}
									</Breadcrumb.Page>
								{/if}
							</Breadcrumb.Item>
						{/each}
					</Breadcrumb.List>
				</Breadcrumb.Root>
			{/if}
		</div>

		<div class="flex items-center justify-end gap-3">
			<ThemeToggle />
			<UserMenu {user} />
		</div>
	</div>
</header>
