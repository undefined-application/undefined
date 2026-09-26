<script lang="ts">
	// Right rail of the wiki: what was analysed and how sure we are (plan §5 Tab 1 "Scope and
	// coverage"), and the history behind it.
	import { num } from '$lib/format';
	import type { ScanSummary } from '$lib/scan';

	interface Props {
		scan: ScanSummary;
	}

	let { scan }: Props = $props();

	const st = $derived(scan.stats?.structure);
	const git = $derived(scan.stats?.git);
</script>

{#snippet row(label: string, value: number | undefined, tone = '')}
	<dt class="text-muted-foreground">{label}</dt>
	<dd class="text-right tabular-nums {value ? tone : ''}">{num(value)}</dd>
{/snippet}

<div class="grid gap-6 text-[12px]">
	{#if scan.stats}
		<section>
			<h3 class="mb-2 text-xs font-semibold">Coverage</h3>
			<dl class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
				{@render row('Files analysed in depth', scan.stats.deepFiles)}
				{@render row('Files indexed for references', scan.stats.files)}
				{#if st}
					{@render row('Functions', st.functions)}
					{@render row('Classes', st.classes)}
					{@render row('Resolved links', st.edges.resolved)}
					{@render row('Ambiguous links', st.edges.ambiguous, 'text-risky')}
					{@render row('Unresolved links', st.edges.unresolved, 'text-risky')}
					{@render row('Outside files that use it', st.boundaryFiles)}
				{/if}
			</dl>
		</section>
	{/if}

	{#if git}
		<section>
			<h3 class="mb-2 text-xs font-semibold">History</h3>
			<dl class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
				{@render row('Commits', git.commits)}
				{@render row('Bug fixes', git.bugfixCommits)}
				{@render row('Reverts', git.reverts)}
				{@render row('Hardware or timing reason', git.rationaleCommits)}
				{@render row('Authors', git.authors)}
				{@render row('Files changed together', git.coChangePairs)}
			</dl>
		</section>
	{/if}
</div>
