<script lang="ts">
	import { apiFetch } from '$lib/api';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import LockIcon from '@lucide/svelte/icons/lock';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import GithubMark from '$lib/components/brand/GithubMark.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import type { BranchSummary, RepoSummary } from '$lib/github';
	import { cn } from '$lib/utils';

	interface Props {
		repos: Promise<RepoSummary[]>;
		open?: boolean;
	}

	let { repos, open = $bindable(false) }: Props = $props();

	let query = $state('');
	let repo = $state<RepoSummary | null>(null);
	let repoError = $state('');
	let resolving = $state(false);
	let listOpen = $state(false);
	/** Keyboard-highlighted suggestion (arrow keys), -1 when none. */
	let active = $state(-1);
	let repoList = $state<RepoSummary[]>([]);
	let ref = $state('');
	let subpath = $state('');
	let referenceScope = $state<'repo' | 'subpath'>('repo');
	let submitting = $state(false);
	let submitError = $state('');

	const branches = $derived(repo ? fetchBranches(repo) : null);

	// The suggestion list is needed synchronously for keyboard navigation.
	$effect(() => {
		let current = true;
		repos.then((list) => current && (repoList = list)).catch(() => {});
		return () => {
			current = false;
		};
	});

	async function getJson<T>(url: string): Promise<T> {
		const res = await apiFetch(url);
		const body = await res.json().catch(() => null);
		if (!res.ok) throw new Error(body?.message ?? res.statusText);
		return body as T;
	}

	async function fetchBranches(r: RepoSummary): Promise<BranchSummary[]> {
		const list = await getJson<BranchSummary[]>(`/api/github/repos/${r.owner}/${r.name}/branches`);
		// Default branch first, the rest alphabetical.
		return list.sort(
			(a, b) =>
				Number(b.name === r.defaultBranch) - Number(a.name === r.defaultBranch) ||
				a.name.localeCompare(b.name)
		);
	}

	function choose(r: RepoSummary) {
		repo = r;
		query = r.fullName;
		ref = r.defaultBranch;
		repoError = '';
		listOpen = false;
		active = -1;
	}

	const typed = $derived(
		query
			.trim()
			.replace(/^https?:\/\/github\.com\//, '')
			.replace(/\.git$|\/$/g, '')
	);

	/** Any public repo, not just the user's own (e.g. ArduPilot/ardupilot). */
	async function resolveTyped() {
		if (!/^[\w.-]+\/[\w.-]+$/.test(typed)) {
			repoError = 'Use owner/name, for example ArduPilot/ardupilot.';
			return;
		}
		resolving = true;
		repoError = '';
		try {
			choose(await getJson<RepoSummary>(`/api/github/repos/${typed}`));
		} catch (err) {
			repoError = (err as Error).message;
		} finally {
			resolving = false;
		}
	}

	/** The demo target (docs/spike-results.md): ArduPilot's IMU drivers. */
	async function useDemo() {
		query = 'ArduPilot/ardupilot';
		subpath = 'libraries/AP_InertialSensor';
		referenceScope = 'repo';
		await resolveTyped();
	}

	const found = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return repoList.filter((r) => !q || r.fullName.toLowerCase().includes(q)).slice(0, 7);
	});
	const showList = $derived(listOpen && !repo && found.length > 0);

	function onRepoKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			if (!found.length || repo) return;
			e.preventDefault();
			listOpen = true;
			const step = e.key === 'ArrowDown' ? 1 : -1;
			active = (active + step + found.length) % found.length;
			document.getElementById(`scan-repo-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
		} else if (e.key === 'Enter' && !repo) {
			e.preventDefault();
			if (showList && active >= 0) choose(found[active]);
			else resolveTyped();
		} else if (e.key === 'Escape' && showList) {
			// Close the list, not the dialog.
			e.preventDefault();
			e.stopPropagation();
			listOpen = false;
		}
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!repo) {
			await resolveTyped();
			if (!repo) return;
		}
		submitting = true;
		submitError = '';
		try {
			const res = await apiFetch('/api/scans', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					repo: repo.fullName,
					ref,
					subpath,
					reference_scope: referenceScope
				})
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.message ?? res.statusText);
			open = false;
			await goto(resolve(`/scans/${body.scan_id}/overview`));
		} catch (err) {
			submitError = (err as Error).message;
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="gap-5 p-5 sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
		<Dialog.Header>
			<Dialog.Title class="text-base">New scan</Dialog.Title>
			<Dialog.Description>Pick a repository and the part to analyse.</Dialog.Description>
		</Dialog.Header>

		<form class="grid gap-4" onsubmit={submit}>
			<Field.Field>
				<Field.Label for="scan-repo">Repository</Field.Label>
				<div class="relative">
					<GithubMark
						class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						id="scan-repo"
						bind:value={query}
						placeholder="owner/name or a GitHub URL"
						autocomplete="off"
						spellcheck={false}
						class="pl-7"
						role="combobox"
						aria-autocomplete="list"
						aria-expanded={showList}
						aria-controls="scan-repo-list"
						aria-activedescendant={showList && active >= 0 ? `scan-repo-opt-${active}` : undefined}
						onfocus={() => (listOpen = true)}
						onblur={() => setTimeout(() => (listOpen = false), 120)}
						oninput={() => {
							repo = null;
							listOpen = true;
							active = -1;
						}}
						onkeydown={onRepoKey}
					/>
					{#if resolving}
						<Loader2Icon
							class="absolute top-1/2 right-2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
						/>
					{/if}
					{#if showList}
						<ul
							id="scan-repo-list"
							role="listbox"
							aria-label="Repositories"
							class="absolute inset-x-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-md bg-popover p-1 shadow-md ring-1 ring-foreground/10"
						>
							{#each found as r, i (r.fullName)}
								<!-- Keyboard lives on the combobox input (aria-activedescendant). -->
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<li
									id="scan-repo-opt-{i}"
									role="option"
									aria-selected={i === active}
									class={cn(
										'flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs',
										i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
									)}
									onmousedown={(e) => e.preventDefault()}
									onmousemove={() => (active = i)}
									onclick={() => choose(r)}
								>
									<GithubMark class="size-3.5 shrink-0 text-muted-foreground" />
									<span class="truncate">
										<span class="text-muted-foreground">{r.owner}/</span><span class="font-medium"
											>{r.name}</span
										>
									</span>
									{#if r.private}<LockIcon class="size-3 shrink-0 text-muted-foreground" />{/if}
									{#if r.fork}<span class="text-[10.5px] text-muted-foreground">fork</span>{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
				{#if repoError}
					<Field.Error>{repoError}</Field.Error>
				{:else}
					<Field.Description class="flex flex-wrap items-center gap-x-1">
						Your GitHub repositories, or any public one.
						<button
							type="button"
							class="inline-flex items-center gap-1 text-link hover:underline"
							onclick={useDemo}
						>
							<SparklesIcon class="size-3" />
							Try the ArduPilot IMU drivers
						</button>
					</Field.Description>
				{/if}
			</Field.Field>

			<div class="grid gap-4 sm:grid-cols-2">
				<Field.Field>
					<Field.Label>Branch</Field.Label>
					<Select.Root type="single" bind:value={ref} disabled={!branches}>
						<Select.Trigger class="w-full">
							{ref || (repo ? 'Loading branches…' : 'Pick a repository')}
						</Select.Trigger>
						<Select.Content class="max-h-72">
							{#if branches}
								{#await branches}
									<Select.Item value={ref} disabled>Loading branches…</Select.Item>
								{:then list}
									{#each list as b (b.name)}
										<Select.Item value={b.name}>{b.name}</Select.Item>
									{/each}
								{:catch err}
									<Select.Item value="" disabled>{err.message}</Select.Item>
								{/await}
							{/if}
						</Select.Content>
					</Select.Root>
				</Field.Field>
				<Field.Field>
					<Field.Label>Reference scope</Field.Label>
					<ToggleGroup.Root
						type="single"
						variant="outline"
						bind:value={
							() => referenceScope,
							(v) => {
								if (v) referenceScope = v as 'repo' | 'subpath';
							}
						}
						class="w-full"
					>
						<ToggleGroup.Item value="repo" class="flex-1">Whole repo</ToggleGroup.Item>
						<ToggleGroup.Item value="subpath" class="flex-1">Subpath only</ToggleGroup.Item>
					</ToggleGroup.Root>
				</Field.Field>
			</div>

			<Field.Field>
				<Field.Label for="scan-subpath">Deep scope</Field.Label>
				<Input
					id="scan-subpath"
					bind:value={subpath}
					placeholder="libraries/AP_InertialSensor"
					spellcheck={false}
				/>
			</Field.Field>

			{#if submitError}
				<p role="alert" class="text-xs text-destructive">{submitError}</p>
			{/if}

			<Dialog.Footer class="mt-1">
				<Dialog.Close>
					{#snippet child({ props })}
						<Button variant="ghost" {...props}>Cancel</Button>
					{/snippet}
				</Dialog.Close>
				<Button
					type="submit"
					class={cn('min-w-20 pressable')}
					disabled={submitting || resolving || (!repo && !typed)}
				>
					{#if submitting}<Loader2Icon class="animate-spin" />{/if}
					Start scan
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
