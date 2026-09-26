<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import OrbitIcon from '@lucide/svelte/icons/orbit';
	import { resolve } from '$app/paths';
	import AskAuthor from '$lib/components/AskAuthor.svelte';
	import ClaimList from '$lib/components/ClaimList.svelte';
	import LevelBadge from '$lib/components/LevelBadge.svelte';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { basename } from '$lib/format';
	import type { CriticalPart } from '$lib/model';

	interface Props {
		part: CriticalPart;
		rank: number;
		repo: string;
		commit: string;
		scanId: string;
		open?: boolean;
	}

	let { part, rank, repo, commit, scanId, open = $bindable(false) }: Props = $props();

	const short = $derived(part.name.split('::').pop()!);
	const owner = $derived(
		part.name.includes('::') ? part.name.slice(0, part.name.lastIndexOf('::')) : ''
	);
</script>

<Collapsible.Root bind:open class="group/part">
	<div
		class="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
	>
		<span class="text-right text-[12px] text-muted-foreground tabular-nums">{rank}</span>
		<Collapsible.Trigger class="flex min-w-0 items-center gap-2 text-left outline-none">
			<ChevronRightIcon
				class="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]/part:rotate-90"
			/>
			<span class="min-w-0">
				<span class="block truncate text-[13px]">
					{#if owner}<span class="text-muted-foreground">{owner}::</span>{/if}<span
						class="font-medium text-foreground">{short}</span
					>
				</span>
				<span class="block truncate text-[11px] text-muted-foreground">
					{basename(part.path)}:{part.start}-{part.end}
				</span>
			</span>
		</Collapsible.Trigger>
		<div class="flex items-center gap-2">
			<span class="text-[11px] text-muted-foreground tabular-nums max-sm:hidden">{part.score}</span>
			<LevelBadge level={part.level} />
		</div>
	</div>
	<Collapsible.Content>
		<div class="ml-10 grid gap-3 border-l border-border pt-1 pb-4 pl-4">
			{#if part.factors.length}
				<ul class="flex flex-wrap gap-1">
					{#each part.factors.slice(0, 8) as f (f.factor + f.detail)}
						<li
							class="inline-flex h-5 items-center gap-1 rounded-sm bg-muted px-1.5 text-[11px] text-muted-foreground ring-1 ring-border ring-inset"
							title={f.detail}
						>
							{f.factor.replaceAll('_', ' ')}
							<span class="text-foreground">+{f.points}</span>
						</li>
					{/each}
				</ul>
			{/if}
			<ClaimList claims={part.claims} {repo} />
			<div class="flex flex-wrap items-center gap-1.5">
				{#if part.ask}
					<AskAuthor person={part.ask} {repo} about="{basename(part.path)}:{part.start}" />
				{/if}
				<a
					href="{resolve(`/scans/${scanId}/graph`)}?level=symbol&file={encodeURIComponent(
						part.path
					)}&focus={encodeURIComponent(part.id)}"
					class="inline-flex h-6 pressable items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground ring-1 ring-border transition-colors hover:bg-muted hover:text-foreground"
				>
					<OrbitIcon class="size-3" />
					Blast radius
				</a>
				<a
					href="https://github.com/{repo}/blob/{commit}/{part.path}#L{part.start}-L{part.end}"
					target="_blank"
					rel="noreferrer"
					class="inline-flex h-6 items-center px-1 text-xs text-link hover:underline"
				>
					Read the code
				</a>
			</div>
		</div>
	</Collapsible.Content>
</Collapsible.Root>
