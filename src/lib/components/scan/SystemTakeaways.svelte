<script lang="ts">
	// "Before you change it" (docs/ui-spec.md §4.3), under the model's intro: the page in three
	// lines at most. Picked in this order from what applies: who breaks if the subsystem changes,
	// who bypasses its public header, where the risk sits (linking down to its sections), what
	// platform it runs on, what it is tangled with both ways. Counted from resolved #includes,
	// criticality and traced fences, so it renders without the model. Names link to GitHub.
	import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
	import CpuIcon from '@lucide/svelte/icons/cpu';
	import OctagonXIcon from '@lucide/svelte/icons/octagon-x';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { basename, num, plural } from '$lib/format';
	import SourceMark from '$lib/components/SourceMark.svelte';
	import { HOW } from './how';
	import Takeaway from './Takeaway.svelte';
	import type { Architecture, ComponentInfo, CriticalPart, Fence } from '$lib/model';

	interface Props {
		arch: Architecture;
		components: ComponentInfo[];
		critical: CriticalPart[];
		/** "What not to break" once traced; null while tracing (the risk line waits for it). */
		fences: Fence[] | null;
		repo: string;
		commit: string;
		/** The deep scope's name. */
		scope: string;
	}

	let { arch, components, critical, fences, repo, commit, scope }: Props = $props();

	/** Platform layers: where hardware and OS assumptions live. */
	const PLATFORM =
		/(^|_)(hal|bsp|cmsis|chibios|nuttx|freertos|rtos|linux|platform|arch|board)(_|$)/i;

	type Named = { name: string; path: string };
	const one = (n: number, single: string, many: string) => (n === 1 ? single : many);
	const short = (name: string) => name.replace(/ \+\d+$/, '');

	const publicName = $derived(arch.publicHeader ? basename(arch.publicHeader) : null);
	const usedFiles = $derived(arch.usedBy.reduce((n, m) => n + m.files, 0));
	/** Outside modules that include a component's internal header, and which headers. */
	const bypass = $derived.by((): Named[] => {
		const paths = [...new Set(arch.reachIn.map((r) => r.module))];
		return paths.map((path) => ({ name: basename(path), path }));
	});
	const bypassed = $derived.by((): Named[] => {
		const paths = [...new Set(arch.reachIn.map((r) => r.header))];
		return paths.map((path) => ({ name: basename(path), path }));
	});
	const usedNames = $derived(new Set(arch.usedBy.map((m) => m.name)));
	const twoWay = $derived(arch.dependsOn.filter((m) => usedNames.has(m.name)));
	const platform = $derived(arch.dependsOn.filter((m) => PLATFORM.test(m.name)));

	const high = $derived(critical.filter((c) => c.level === 'high'));
	/** Where the high-criticality functions live, most first. */
	const hotspots = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt per derivation, never mutated after
		const counts = new Map<string, number>();
		for (const p of high) {
			const c = components.find((x) => x.files.includes(p.path));
			if (c) counts.set(short(c.name), (counts.get(short(c.name)) ?? 0) + 1);
		}
		return [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
	});
	/** At most three lines, the most useful first: blast radius, hidden coupling, risk. */
	const shown = $derived(
		(
			[
				['users', arch.usedBy.length],
				['bypass', bypass.length],
				['risk', high.length || fences?.length],
				['platform', platform.length],
				['twoWay', twoWay.length]
			] as const
		)
			.filter(([, n]) => !!n)
			.slice(0, 3)
			.map(([key]) => key)
	);
</script>

{#snippet list(items: Named[], kind: 'tree' | 'blob', max = 4)}
	{#each items.slice(0, max) as m, i (m.path)}{i === 0
			? ''
			: i === Math.min(items.length, max) - 1 && items.length <= max
				? ' and '
				: ', '}<a
			href="https://github.com/{repo}/{kind}/{commit}/{m.path}"
			target="_blank"
			rel="noreferrer"
			class="font-medium hover:underline">{m.name}</a
		>{/each}{items.length > max ? ` and ${items.length - max} more` : ''}
{/snippet}

{#snippet section(id: string, label: string)}
	<a href="#{id}" class="text-link">{label}</a>
{/snippet}

{#if shown.length}
	<section aria-labelledby="before-change">
		<h2 id="before-change" class="flex items-center gap-2 text-[13px] font-semibold">
			Before you change it
			<SourceMark kind="deterministic" how={HOW.takeaways} />
		</h2>
		<ul class="mt-2 grid max-w-[68ch] gap-2 text-[13.5px] leading-relaxed">
			{#if shown.includes('users')}
				<Takeaway>
					{#snippet icon()}<UsersIcon
							class="size-3.5 text-muted-foreground"
							aria-hidden="true"
						/>{/snippet}
					<span class="font-medium">{plural(arch.usedBy.length, 'module')}</span>
					({num(usedFiles)} files) include {scope}{#if arch.publicHeader}, mostly through
						<a
							href="https://github.com/{repo}/blob/{commit}/{arch.publicHeader}"
							target="_blank"
							rel="noreferrer"
							class="hover:underline">{publicName}</a
						>{/if}. Change it and check {@render list(arch.usedBy.slice(0, 3), 'tree')} first.
				</Takeaway>
			{/if}
			{#if shown.includes('bypass')}
				<Takeaway>
					{#snippet icon()}<TriangleAlertIcon
							class="size-3.5 text-dangerous"
							aria-hidden="true"
						/>{/snippet}
					{@render list(bypass, 'tree')}
					{one(bypass.length, 'skips', 'skip')} the public interface and
					{one(bypass.length, 'includes', 'include')}
					{@render list(bypassed, 'blob', 3)} directly. A change inside that driver can break {one(
						bypass.length,
						'it',
						'them'
					)} even when {publicName ?? 'the public header'} stays the same.
				</Takeaway>
			{/if}
			{#if shown.includes('risk')}
				<Takeaway>
					{#snippet icon()}<OctagonXIcon class="size-3.5 text-stop" aria-hidden="true" />{/snippet}
					{#if fences?.length}
						<span class="font-medium">{plural(fences.length, 'place')}</span> look removable but
						their history says otherwise ({@render section('fences', 'What not to break')}).
					{/if}
					{#if high.length}
						<span class="font-medium"
							>{high.length}
							{one(high.length, 'function is', 'functions are')} highly critical</span
						>{#if hotspots.length}, mostly in {hotspots.slice(0, 2).join(' and ')}{/if}
						({@render section('critical', 'Critical functions')}).
					{/if}
				</Takeaway>
			{/if}
			{#if shown.includes('twoWay')}
				<Takeaway>
					{#snippet icon()}<ArrowLeftRightIcon
							class="size-3.5 text-risky"
							aria-hidden="true"
						/>{/snippet}
					{@render list(twoWay, 'tree')}
					{one(twoWay.length, 'uses', 'use')}
					{scope} and {scope} uses {one(twoWay.length, 'it', 'them')}. Change them together; none
					can be swapped out on its own.
				</Takeaway>
			{/if}
			{#if shown.includes('platform')}
				<Takeaway>
					{#snippet icon()}<CpuIcon
							class="size-3.5 text-muted-foreground"
							aria-hidden="true"
						/>{/snippet}
					Runs on {@render list(platform, 'tree')}. Hardware and OS assumptions come in through
					there: look there when a board or chip changes.
				</Takeaway>
			{/if}
		</ul>
	</section>
{/if}
