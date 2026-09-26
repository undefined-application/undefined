<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import LogoMark from '$lib/components/brand/LogoMark.svelte';
	import { Button } from '$lib/components/ui/button';

	const notFound = $derived(page.status === 404);
</script>

<svelte:head><title>{page.status} · undefined</title></svelte:head>

<main class="grid min-h-dvh place-items-center bg-background px-6">
	<div class="max-w-md text-center">
		<LogoMark class="mx-auto size-10" />
		<p class="mt-6 text-sm text-muted-foreground">{page.status}</p>
		<h1 class="mt-1 text-2xl font-semibold tracking-tight">
			{notFound ? 'This page is undefined' : 'Something went wrong'}
		</h1>
		<p class="mt-2 text-[13px] leading-relaxed text-muted-foreground">
			{notFound
				? 'The scan or review may have been deleted, or the link is wrong.'
				: (page.error?.message ?? 'The server could not finish this request.')}
		</p>
		<Button href={resolve('/')} variant="outline" class="mt-6 pressable">Back to systems</Button>
	</div>
</main>
