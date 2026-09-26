<script lang="ts">
	// One "Before you change it" line: an icon and the sentence.
	import type { Snippet } from 'svelte';

	interface Props {
		icon: Snippet;
		children: Snippet;
	}

	let { icon, children }: Props = $props();
</script>

<li class="flex gap-2.5">
	<span class="mt-1 shrink-0">{@render icon()}</span>
	<span>{@render children()}</span>
</li>
