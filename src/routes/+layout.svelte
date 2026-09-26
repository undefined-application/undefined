<script lang="ts">
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import favicon from '$lib/assets/favicon.svg';
	import { Toaster } from '$lib/components/ui/sonner';
	import { Tooltip } from 'bits-ui';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#0c0a09" media="(prefers-color-scheme: dark)" />
	<meta name="theme-color" content="#fcfcfb" media="(prefers-color-scheme: light)" />
</svelte:head>

<ModeWatcher defaultMode="system" disableTransitions={false} />
<Toaster position="bottom-right" />
<!-- Moving from one tooltip to the next shows it at once (skipDelayDuration). -->
<Tooltip.Provider delayDuration={150} skipDelayDuration={400}>
	{@render children()}
</Tooltip.Provider>
