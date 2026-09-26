<script lang="ts">
	// Deleting a repository is irreversible: an alert dialog that names what goes, and a button that
	// repeats the verb (docs/ui-spec.md §4.2).
	import { apiFetch } from '$lib/api';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { buttonVariants } from '$lib/components/ui/button';
	import { plural } from '$lib/format';
	import { cn } from '$lib/utils';

	interface Props {
		repo: string;
		scans: number;
		reviews: number;
		open?: boolean;
		/** After the repository is gone. */
		ondeleted?: () => void | Promise<void>;
	}

	let { repo, scans, reviews, open = $bindable(false), ondeleted }: Props = $props();

	let deleting = $state(false);
	let error = $state('');

	const what = $derived(
		[scans && plural(scans, 'scan'), reviews && plural(reviews, 'review')]
			.filter(Boolean)
			.join(' and ')
	);

	async function remove(e: Event) {
		e.preventDefault();
		deleting = true;
		error = '';
		try {
			const res = await apiFetch(`/api/repos/${repo}`, { method: 'DELETE' });
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.message ?? res.statusText);
			open = false;
			toast.success(`Deleted ${repo}`, {
				description: body?.cloneRemoved
					? 'Scans, reviews, analysis and the local clone are gone.'
					: 'Your scans and reviews are gone. The clone stays for other users.'
			});
			await ondeleted?.();
		} catch (err) {
			error = (err as Error).message;
		} finally {
			deleting = false;
		}
	}
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content class="sm:max-w-md">
		<AlertDialog.Header>
			<AlertDialog.Media class="bg-destructive/10 text-destructive">
				<Trash2Icon />
			</AlertDialog.Media>
			<AlertDialog.Title>Delete <span class="">{repo}</span>?</AlertDialog.Title>
			<AlertDialog.Description>
				This removes your {what || 'data'} of this repository, the stored analysis and the local clone.
				It can't be undone. Nothing on GitHub changes.
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if error}
			<p role="alert" class="text-xs text-destructive">{error}</p>
		{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={deleting}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class={cn(buttonVariants({ variant: 'destructive' }), 'pressable')}
				disabled={deleting}
				onclick={remove}
			>
				{#if deleting}<Loader2Icon class="animate-spin" />{/if}
				Delete repository
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
