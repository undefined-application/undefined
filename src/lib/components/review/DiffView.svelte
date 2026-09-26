<script lang="ts" module>
	import type { ChangeClass } from '$lib/review';

	export const CHANGE_CLASS: Record<ChangeClass, { label: string; behaviourFree: boolean }> = {
		comment_whitespace: { label: 'Comments or whitespace', behaviourFree: true },
		log_string: { label: 'Log text', behaviourFree: true },
		docs: { label: 'Docs', behaviourFree: true },
		code: { label: 'Code', behaviourFree: false }
	};
</script>

<script lang="ts">
	// GitHub's "Files changed": a unified diff with context, and each finding shown under the lines
	// it cites, like a review comment (docs/ui-spec.md §4.7).
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import FileCodeIcon from '@lucide/svelte/icons/file-code';
	import FileMinusIcon from '@lucide/svelte/icons/file-minus';
	import FilePlusIcon from '@lucide/svelte/icons/file-plus';
	import LogoMark from '$lib/components/brand/LogoMark.svelte';
	import ClaimList from '$lib/components/ClaimList.svelte';
	import VerdictChip from '$lib/components/VerdictChip.svelte';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import type { DiffFile, Finding } from '$lib/review';
	import { cn } from '$lib/utils';

	interface Props {
		files: DiffFile[];
		classes: { path: string; class: ChangeClass }[];
		findings: Finding[];
		snapshots: { mergeBase: string; head: string };
		repo: string;
	}

	let { files, classes, findings, snapshots, repo }: Props = $props();

	const classOf = $derived(new Map(classes.map((c) => [c.path, c.class])));

	/** Findings anchored to the first diff row inside one of their code citations. */
	const anchored = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built once per derivation
		const at = new Map<string, Finding[]>();
		for (const f of findings) {
			const cites = f.claims.flatMap((c) => c.citations);
			let placed = false;
			for (const c of cites) {
				if (placed || c.kind !== 'code') continue;
				const fi = files.findIndex((x) => x.path === c.path);
				if (fi < 0) continue;
				const side = c.commit === snapshots.head ? 'new' : 'old';
				files[fi].hunks.forEach((h, hi) => {
					if (placed) return;
					const ri = h.lines.findIndex((row) => {
						const n = side === 'new' ? row.new : row.old;
						return n !== null && n >= c.start && n <= c.end;
					});
					if (ri < 0) return;
					const key = `${fi}:${hi}:${ri}`;
					at.set(key, [...(at.get(key) ?? []), f]);
					placed = true;
				});
			}
		}
		return at;
	});
</script>

<div class="grid gap-4">
	{#each files as file, fi (file.path)}
		{@const cls = classOf.get(file.path)}
		<Collapsible.Root open class="group/file overflow-hidden rounded-xl bg-card ring-1 ring-border">
			<div
				class="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 group-data-[state=closed]/file:border-b-0"
			>
				<Collapsible.Trigger
					class="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted"
					aria-label="Toggle {file.path}"
				>
					<ChevronDownIcon
						class="size-3.5 transition-transform group-data-[state=closed]/file:-rotate-90"
					/>
				</Collapsible.Trigger>
				{#if file.status === 'added'}
					<FilePlusIcon class="size-3.5 text-safe" />
				{:else if file.status === 'deleted'}
					<FileMinusIcon class="size-3.5 text-stop" />
				{:else}
					<FileCodeIcon class="size-3.5 text-muted-foreground" />
				{/if}
				<a
					href="https://github.com/{repo}/blob/{file.status === 'deleted'
						? snapshots.mergeBase
						: snapshots.head}/{file.path}"
					target="_blank"
					rel="noreferrer"
					class="min-w-0 truncate text-[12px] hover:text-link hover:underline">{file.path}</a
				>
				<span class="ml-auto flex shrink-0 items-center gap-2 text-[11px]">
					<span class="text-safe">+{file.additions}</span>
					<span class="text-stop">-{file.deletions}</span>
					{#if cls}
						<span
							class={cn(
								'rounded-sm px-1.5 py-0.5 font-sans text-[10.5px] ring-1 ring-inset',
								CHANGE_CLASS[cls].behaviourFree
									? 'bg-safe/10 text-safe ring-safe/25'
									: 'bg-muted text-muted-foreground ring-border'
							)}>{CHANGE_CLASS[cls].label}</span
						>
					{/if}
				</span>
			</div>
			<Collapsible.Content>
				{#if file.binary}
					<p class="px-4 py-3 text-xs text-muted-foreground">Binary file, not shown.</p>
				{:else}
					<div class="scrollbar-thin overflow-x-auto font-mono text-[11.5px] leading-[1.6]">
						<table class="w-full border-collapse">
							<tbody>
								{#each file.hunks as hunk, hi (hi)}
									<tr class="bg-link/5 text-muted-foreground">
										<td colspan="4" class="px-3 py-1 whitespace-pre">{hunk.header}</td>
									</tr>
									{#each hunk.lines as row, ri (ri)}
										<tr
											class={cn(
												row.kind === 'add' && 'bg-diff-add',
												row.kind === 'del' && 'bg-diff-del'
											)}
										>
											<td
												class="w-12 min-w-12 border-r border-border/60 px-2 text-right text-muted-foreground/70 select-none"
												>{row.old ?? ''}</td
											>
											<td
												class="w-12 min-w-12 border-r border-border/60 px-2 text-right text-muted-foreground/70 select-none"
												>{row.new ?? ''}</td
											>
											<td
												class={cn(
													'w-5 pl-2 select-none',
													row.kind === 'add' && 'text-safe',
													row.kind === 'del' && 'text-stop'
												)}>{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ''}</td
											>
											<td class="pr-4 whitespace-pre text-foreground/90" style="tab-size: 4"
												>{row.text}</td
											>
										</tr>
										{#each anchored.get(`${fi}:${hi}:${ri}`) ?? [] as f, k (k)}
											<tr>
												<td
													colspan="4"
													class="border-y border-border bg-background px-3 py-3 font-sans"
												>
													<div class="max-w-3xl rounded-lg bg-card p-3 ring-1 ring-border">
														<p class="mb-2 flex flex-wrap items-center gap-2 text-[12.5px]">
															<LogoMark class="size-4" />
															<span class="font-semibold">undefined</span>
															{#if f.severity !== 'INFO'}<VerdictChip verdict={f.severity} />{/if}
															<span class="text-foreground/90">{f.title}</span>
														</p>
														<ClaimList claims={f.claims} {repo} />
													</div>
												</td>
											</tr>
										{/each}
									{/each}
								{/each}
							</tbody>
						</table>
					</div>
					{#if file.truncated}
						<p class="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
							Long diff: the rest is on GitHub.
						</p>
					{/if}
				{/if}
			</Collapsible.Content>
		</Collapsible.Root>
	{/each}
</div>
