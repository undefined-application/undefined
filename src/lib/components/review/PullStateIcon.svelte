<script lang="ts">
	// GitHub's pull request states, in GitHub's colours: that is what reviewers already read.
	import GitMergeIcon from '@lucide/svelte/icons/git-merge';
	import GitPullRequestClosedIcon from '@lucide/svelte/icons/git-pull-request-closed';
	import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request';
	import { cn } from '$lib/utils';

	interface Props {
		state: 'open' | 'closed';
		merged: boolean;
		class?: string;
	}

	let { state, merged, class: className }: Props = $props();
</script>

{#if merged}
	<GitMergeIcon class={cn('size-4 text-pr-merged', className)} aria-label="Merged" />
{:else if state === 'closed'}
	<GitPullRequestClosedIcon class={cn('size-4 text-pr-closed', className)} aria-label="Closed" />
{:else}
	<GitPullRequestIcon class={cn('size-4 text-pr-open', className)} aria-label="Open" />
{/if}
