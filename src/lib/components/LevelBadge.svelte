<script lang="ts">
	// Criticality: high / medium / low, always spelled out next to the colour.
	import type { Level } from '$lib/model';
	import { cn } from '$lib/utils';

	interface Props {
		level: Level;
		class?: string;
	}

	let { level, class: className }: Props = $props();

	const styles: Record<Level, string> = {
		high: 'text-stop bg-stop/10 ring-stop/25',
		medium: 'text-risky bg-risky/10 ring-risky/30',
		low: 'text-muted-foreground bg-muted ring-border'
	};
	const bars: Record<Level, number> = { high: 3, medium: 2, low: 1 };
</script>

<span
	class={cn(
		'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-[10.5px] font-medium ring-1 ring-inset',
		styles[level],
		className
	)}
>
	<span class="flex items-end gap-px" aria-hidden="true">
		{#each [1, 2, 3] as i (i)}
			<span
				class={cn('w-[3px] rounded-[1px] bg-current', i > bars[level] && 'opacity-25')}
				style="height: {3 + i * 2}px"
			></span>
		{/each}
	</span>
	{level}
</span>
