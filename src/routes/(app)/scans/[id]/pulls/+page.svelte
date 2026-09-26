<script lang="ts">
	import PullList from '$lib/components/review/PullList.svelte';
	import ReviewRows from '$lib/components/review/ReviewRows.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const scan = $derived(data.scan);
</script>

<svelte:head><title>Pull requests · {scan.repo}</title></svelte:head>

<div class="mx-auto grid max-w-5xl gap-10 px-4 pt-8 pb-48 sm:px-8">
	<header>
		<p class="text-xs text-muted-foreground">{scan.repo}</p>
		<h1 class="mt-1 text-3xl font-semibold tracking-[-0.025em]">Pull requests</h1>
		<p class="mt-3 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
			Review a change before it merges. Merged PRs work too.
		</p>
	</header>

	{#if data.reviews.length}
		<section>
			<h2 class="mb-3 text-sm font-semibold">Reviewed</h2>
			<ReviewRows scanId={scan.id} reviews={data.reviews} />
		</section>
	{/if}

	<section>
		<h2 class="mb-3 text-sm font-semibold">On GitHub</h2>
		<PullList repo={scan.repo} scanId={scan.id} reviews={data.reviews} />
	</section>
</div>
