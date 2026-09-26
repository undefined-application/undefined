<script lang="ts">
	// Live stage timeline while a scan runs (plan §4.2 stages 0-5; 6-7 are not built yet).
	import CheckIcon from '@lucide/svelte/icons/check';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { IMPLEMENTED_STAGES, SCAN_STAGES, type ScanSummary } from '$lib/scan';
	import { cn } from '$lib/utils';

	let { scan }: { scan: ScanSummary } = $props();

	const detail: Record<number, string> = {
		0: 'Cloning without blobs and listing files',
		1: 'Parsing C/C++: symbols, calls, includes',
		2: 'Reading history: commits, blame, co-change',
		3: 'Timing, ISR, register and workaround signals',
		4: 'Grouping files into components',
		5: 'Generating the AI overview'
	};

	function state(i: number) {
		if (scan.status === 'done' || i < scan.stage) return 'done';
		if (i > scan.stage) return 'pending';
		return scan.status; // queued | running | failed
	}
</script>

<ol class="grid gap-0" aria-label="Scan progress">
	{#each IMPLEMENTED_STAGES as i (i)}
		{@const s = state(i)}
		<li class="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3">
			<div class="flex flex-col items-center">
				<span
					class={cn(
						'grid size-6 place-items-center rounded-full ring-1 transition-colors',
						s === 'done' && 'bg-link/15 text-link ring-link/30',
						(s === 'running' || s === 'queued') && 'bg-background text-link ring-link/50',
						s === 'failed' && 'bg-destructive/10 text-destructive ring-destructive/40',
						s === 'pending' && 'bg-muted text-muted-foreground ring-border'
					)}
				>
					{#if s === 'done'}<CheckIcon class="size-3.5" />
					{:else if s === 'running' || s === 'queued'}<Loader2Icon class="size-3.5 animate-spin" />
					{:else if s === 'failed'}<XIcon class="size-3.5" />
					{:else}<span class="text-[10px]">{i + 1}</span>{/if}
				</span>
				{#if i !== IMPLEMENTED_STAGES.at(-1)}
					<span class={cn('w-px flex-1', s === 'done' ? 'bg-link/40' : 'bg-border')}></span>
				{/if}
			</div>
			<div class="pb-5">
				<p
					class={cn(
						'text-[13px] font-medium',
						s === 'pending' ? 'text-muted-foreground' : 'text-foreground'
					)}
				>
					{SCAN_STAGES[i]}
				</p>
				<p class="text-xs text-muted-foreground">{detail[i]}</p>
			</div>
		</li>
	{/each}
</ol>
