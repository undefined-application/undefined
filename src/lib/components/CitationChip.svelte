<script lang="ts">
	// A citation as DeepWiki shows sources: file (or commit) and the lines, opening the GitHub
	// permalink at the cited snapshot (plan §3 rule 2).
	import FileCodeIcon from '@lucide/svelte/icons/file-code';
	import GitCommitIcon from '@lucide/svelte/icons/git-commit-horizontal';
	import { permalink, type Citation } from '$lib/claims';
	import { basename } from '$lib/format';

	interface Props {
		citation: Citation;
		repo: string;
	}

	let { citation, repo }: Props = $props();

	const title = $derived(
		citation.kind === 'commit'
			? `${citation.sha.slice(0, 10)}${citation.subject ? `: ${citation.subject}` : ''}`
			: `${citation.path} at ${citation.commit.slice(0, 7)}`
	);
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- GitHub permalink, not an app route -->
<a
	href={permalink(repo, citation)}
	target="_blank"
	rel="noreferrer"
	{title}
	class="inline-flex h-5 max-w-full pressable items-center overflow-hidden rounded-sm bg-muted text-[10.5px] text-foreground/80 ring-1 ring-border transition-colors ring-inset hover:bg-accent hover:text-foreground"
>
	{#if citation.kind === 'code'}
		<span class="flex min-w-0 items-center gap-1 px-1.5">
			<FileCodeIcon class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
			<span class="truncate">{basename(citation.path)}</span>
		</span>
		<span class="h-full border-l border-border px-1.5 leading-5 text-muted-foreground">
			{citation.start}{citation.end > citation.start ? `-${citation.end}` : ''}
		</span>
	{:else}
		<span class="flex min-w-0 items-center gap-1 px-1.5">
			<GitCommitIcon class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
			<span>{citation.sha.slice(0, 7)}</span>
		</span>
		{#if citation.subject}
			<span
				class="h-full max-w-56 truncate border-l border-border px-1.5 font-sans leading-5 text-muted-foreground"
				>{citation.subject}</span
			>
		{/if}
	{/if}
</a>
