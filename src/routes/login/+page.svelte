<script lang="ts">
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import GithubMark from '$lib/components/brand/GithubMark.svelte';
	import Logo from '$lib/components/brand/Logo.svelte';
	import HeroGraph from '$lib/components/graph/HeroGraph.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { Button } from '$lib/components/ui/button';
	import { APP_NAME } from '$lib/config';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let pending = $state(false);
</script>

<svelte:head>
	<title>Sign in · {APP_NAME}</title>
	<meta
		name="description"
		content="Understand a legacy embedded codebase before you change it: critical paths, timing assumptions and who to ask, every claim cited."
	/>
</svelte:head>

<main
	class="relative grid min-h-dvh bg-background lg:grid-cols-2 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
>
	<section class="flex flex-col px-6 py-6 sm:px-10 xl:px-14">
		<header class="absolute top-4 left-4 z-10 flex h-9 items-center sm:top-5 sm:left-5">
			<Logo class="h-7" />
		</header>

		<div class="my-auto max-w-[34rem] py-16">
			<h1
				class="text-4xl leading-[1.08] font-semibold tracking-[-0.03em] text-foreground 2xl:text-5xl"
			>
				<span class="text-muted-foreground">Define the unknown.</span><br />
				Change with confidence.
			</h1>
			<p class="mt-5 max-w-[40ch] text-base leading-relaxed text-muted-foreground">
				Turn unknown legacy code into a system you can change with confidence. undefined uncovers
				hidden intent, timing assumptions and hardware workarounds, cited to the line.
			</p>

			<form method="post" action="?/github" class="mt-9" onsubmit={() => (pending = true)}>
				<Button
					type="submit"
					size="lg"
					class="h-10 pressable gap-2.5 px-4 text-sm"
					disabled={pending}
				>
					{#if pending}
						<Loader2Icon class="size-4 animate-spin" />
					{:else}
						<GithubMark class="size-4" />
					{/if}
					Continue with GitHub
				</Button>
			</form>
			{#if form?.message}
				<p role="alert" class="mt-3 text-sm text-destructive">{form.message}</p>
			{/if}
		</div>
	</section>

	<section
		class="relative hidden overflow-hidden border-l border-border bg-[#f4f3f1] lg:block dark:bg-[#0c0a09]"
		aria-label="A system graph lighting up the blast radius of one function"
	>
		<HeroGraph />
	</section>

	<!-- Pinned to the viewport corner (over the graph on wide screens), level with the logo. -->
	<ThemeToggle class="absolute top-4 right-4 z-10 sm:top-5 sm:right-5" />
</main>
