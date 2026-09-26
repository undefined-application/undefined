<script lang="ts">
	// The wordmark (static/brand): a grey "un" and a foreground "defined", as alpha masks so both
	// halves follow the theme. Height sets the size; width follows the artwork's aspect ratio.
	import { APP_NAME } from '$lib/config';
	import { cn } from '$lib/utils';

	let { class: className }: { class?: string } = $props();
</script>

<!-- No descenders: the box's centre sits on the ascenders, well above the x-height, so the mark
     reads high next to centred icons and text. Nudge it down to centre on its visual mass. -->
<span
	class={cn('inline-flex h-5 shrink-0 translate-y-[12%] items-stretch', className)}
	role="img"
	aria-label={APP_NAME}
>
	<!-- un.png is cropped to its glyphs (197 px of the wordmark's 269): scale it to that share of the
	     height and sit it on the bottom so the x-heights and baseline line up with "defined". -->
	<span
		class="aspect-[323/197] h-[calc(100%*197/269)] self-end brand-mask text-brand-un"
		style="--mask: url(/brand/un.png)"
	></span>
	<span class="aspect-[907/269] brand-mask text-foreground" style="--mask: url(/brand/defined.png)"
	></span>
</span>
