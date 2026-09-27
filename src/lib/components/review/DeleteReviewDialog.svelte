<script lang="ts">
	// Undoing a review is irreversible: an alert dialog that says what goes, and a button that
	// repeats the verb (docs/ui-spec.md §4.2).
	import { apiFetch } from '$lib/api';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { buttonVariants } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';

	interface Props {
		reviewId: string;
		label: string;
		open?: boolean;
		/** After the review is gone. */
		ondeleted?: () => void | Promise<void>;
	}

	let { reviewId, label, open = $bindable(false), ondeleted }: Props = $props();

	let deleting = $state(false);
	let error = $state('');

	async function remove(e: Event) {
		e.preventDefault();
		deleting = true;
		error = '';
		try {
			const res = await apiFetch(`/api/reviews/${reviewId}`, { method: 'DELETE' });
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.message ?? res.statusText);
			open = false;
			toast.success(`Undid the review of ${label}`);
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
				<Undo2Icon />
			</AlertDialog.Media>
			<AlertDialog.Title>Undo the review of {label}?</AlertDialog.Title>
			<AlertDialog.Description>
				Its verdict, findings and overrides are deleted, and the pull request shows as not reviewed.
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
				Undo review
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
