<script lang="ts">
	// Marks where text came from (docs/ui-spec.md §4.3): `ai` for what the model wrote, `deterministic`
	// for what the analysis counted from the code and its history. Small and grey: it labels, it
	// doesn't shout. Hovering (or focusing) it says what exactly that part is worked out from.
	import CogIcon from '@lucide/svelte/icons/cog';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { Tooltip } from 'bits-ui';
	import type { How } from '$lib/components/scan/how';
	import { cn } from '$lib/utils';

	interface Props {
		kind: 'ai' | 'deterministic';
		/** What this part is worked out from (scan/how.ts); a general line when missing. */
		how?: How;
		class?: string;
	}

	let { kind, how, class: className }: Props = $props();

	const MARKS = {
		ai: {
			icon: SparklesIcon,
			label: 'AI',
			kicker: 'Written by AI',
			fallback: {
				title: 'Checked against the code',
				text: 'The model writes from code and commits it was shown, and may only cite those. A claim its citations don’t back is downgraded before it is shown.'
			}
		},
		deterministic: {
			icon: CogIcon,
			label: 'Deterministic',
			kicker: 'Deterministic, no AI',
			fallback: {
				title: 'Counted from the code',
				text: 'Worked out from the code and its git history. The same commit always gives the same result.'
			}
		}
	};

	const mark = $derived(MARKS[kind]);
	const shown = $derived(how ?? mark.fallback);
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				type="button"
				class={cn(
					'inline-flex h-4 shrink-0 cursor-help items-center gap-0.5 rounded-sm bg-muted px-1 align-[1px] text-[10px] leading-none font-medium text-muted-foreground not-italic transition-colors outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-[state$=open]:text-foreground',
					className
				)}
				aria-label="{mark.label}: {shown.title}"
			>
				<mark.icon class="size-2.5" aria-hidden="true" />{mark.label}
			</button>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Portal>
		<Tooltip.Content
			side="bottom"
			align="start"
			sideOffset={6}
			collisionPadding={12}
			class="tip-pop z-50 w-72 rounded-lg glass-card px-3 py-2.5 text-left shadow-lg ring-1 ring-foreground/10"
		>
			<p class="flex items-center gap-1 text-[10.5px] text-muted-foreground">
				<mark.icon class="size-3" aria-hidden="true" />{mark.kicker}
			</p>
			<p class="mt-1.5 text-[12.5px] font-medium text-foreground">{shown.title}</p>
			<p class="mt-0.5 text-[12px] leading-relaxed text-pretty text-muted-foreground">
				{shown.text}
			</p>
		</Tooltip.Content>
	</Tooltip.Portal>
</Tooltip.Root>
