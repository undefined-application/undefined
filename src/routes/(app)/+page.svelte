<script lang="ts">
	import { apiFetch, redirectOn401 } from '$lib/api';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { toast } from 'svelte-sonner';
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import DeleteRepoDialog from '$lib/components/scan/DeleteRepoDialog.svelte';
	import NewScanDialog from '$lib/components/scan/NewScanDialog.svelte';
	import SystemCard from '$lib/components/scan/SystemCard.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Empty from '$lib/components/ui/empty';
	import type { ScanSummary } from '$lib/scan';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// The repo list streams in; a 401 there means the GitHub session is gone.
	$effect(() => redirectOn401(data.repos));

	let newScanOpen = $state(false);
	let deleteOpen = $state(false);
	let target = $state<{ repo: string; scans: number; reviews: number } | null>(null);

	/** One card per repository: its latest scan, with a count of the others. */
	const systems = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built once per derivation
		const byRepo = new Map<string, ScanSummary[]>();
		for (const s of data.scans) byRepo.set(s.repo, [...(byRepo.get(s.repo) ?? []), s]);
		return [...byRepo.values()].map((scans) => ({ latest: scans[0], others: scans.length - 1 }));
	});

	const running = $derived(data.scans.some((s) => s.status === 'queued' || s.status === 'running'));
	$effect(() => {
		if (!running) return;
		const timer = setInterval(() => invalidate('app:systems'), 2000);
		return () => clearInterval(timer);
	});

	async function rescan(scan: ScanSummary) {
		const res = await apiFetch('/api/scans', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				repo: scan.repo,
				ref: scan.ref,
				subpath: scan.deepScope,
				reference_scope: scan.referenceScope
			})
		});
		const body = await res.json().catch(() => null);
		if (!res.ok) {
			toast.error('Could not start the scan', { description: body?.message ?? res.statusText });
			return;
		}
		await goto(resolve(`/scans/${body.scan_id}/overview`));
	}

	function askDelete(repo: string) {
		target = {
			repo,
			scans: data.scans.filter((s) => s.repo === repo).length,
			reviews: data.reviews.filter((r) => r.repo === repo).length
		};
		deleteOpen = true;
	}
</script>

<svelte:head><title>Systems · undefined</title></svelte:head>

<main class="mx-auto w-full max-w-6xl px-4 pt-8 pb-16 sm:px-6 lg:pt-12">
	<header class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Systems</h1>
		</div>
		<Button class="pressable" onclick={() => (newScanOpen = true)}>
			<PlusIcon />
			New scan
		</Button>
	</header>

	{#if systems.length === 0}
		<Empty.Root class="mt-8 rounded-xl border border-dashed py-16">
			<Empty.Header>
				<Empty.Title>Scan your first system</Empty.Title>
				<Empty.Description class="max-w-sm">
					Scan an embedded C/C++ repo to map its critical parts, timing assumptions and
					dependencies.
				</Empty.Description>
			</Empty.Header>
			<Empty.Content>
				<Button class="pressable" onclick={() => (newScanOpen = true)}>
					<PlusIcon />
					New scan
				</Button>
			</Empty.Content>
		</Empty.Root>
	{:else}
		<ul class="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{#each systems as s (s.latest.id)}
				<li>
					<SystemCard
						scan={s.latest}
						others={s.others}
						onrescan={rescan}
						ondelete={() => askDelete(s.latest.repo)}
					/>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<NewScanDialog repos={data.repos} guest={data.user.guest} bind:open={newScanOpen} />
{#if target}
	<DeleteRepoDialog
		repo={target.repo}
		scans={target.scans}
		reviews={target.reviews}
		bind:open={deleteOpen}
		ondeleted={() => invalidate('app:systems')}
	/>
{/if}
