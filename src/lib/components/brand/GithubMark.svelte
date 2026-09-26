<script lang="ts">
	// GitHub's own mark (via Simple Icons); Lucide dropped brand icons.
	import { siGithub } from 'simple-icons';
	import { cn } from '$lib/utils';

	let { class: className }: { class?: string } = $props();
</script>

<svg viewBox="0 0 24 24" class={cn('size-4 fill-current', className)} aria-hidden="true">
	<path d={siGithub.path} />
</svg>
