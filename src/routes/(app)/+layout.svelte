<script lang="ts">
	import AppHeader from '$lib/components/AppHeader.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<div class="min-h-dvh bg-background">
	<AppHeader user={data.user} />
	{@render children()}
</div>
