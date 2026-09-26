<script lang="ts">
	// The small mark: the "un" of the wordmark, drawn in currentColor so it follows the theme.
	import { cn } from '$lib/utils';

	interface Props {
		class?: string;
		/** Accessible name; omit when a visible wordmark sits next to it. */
		title?: string;
	}

	let { class: className, title }: Props = $props();
</script>

<span
	class={cn('inline-block size-6 shrink-0 brand-mask text-brand-un', className)}
	style="--mask: url(/brand/un-mark.png)"
	role={title ? 'img' : undefined}
	aria-hidden={title ? undefined : 'true'}
	aria-label={title}
></span>
