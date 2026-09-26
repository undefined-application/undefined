<script lang="ts">
	// Plan §5 Tab 4 step 8: only a person can move the verdict below the rule floor, with a
	// written reason. Stored and shown on the review.
	import { apiFetch } from '$lib/api';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import { invalidate } from '$app/navigation';
	import VerdictChip from '$lib/components/VerdictChip.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Field from '$lib/components/ui/field';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { Verdict } from '$lib/review';

	interface Props {
		reviewId: string;
		floor: Verdict;
		open?: boolean;
	}

	let { reviewId, floor, open = $bindable(false) }: Props = $props();

	let verdict = $state<Verdict>('RISKY');
	let reason = $state('');
	let saving = $state(false);
	let error = $state('');

	const verdicts: { value: Verdict; hint: string }[] = [
		{ value: 'SAFE', hint: 'Behaviour-free, or checked and covered' },
		{ value: 'RISKY', hint: 'Merge with care' },
		{ value: 'DANGEROUS', hint: 'Needs an expert review' },
		{ value: 'STOP', hint: 'Do not merge' }
	];

	async function save(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		error = '';
		try {
			const res = await apiFetch(`/api/reviews/${reviewId}/override`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ verdict, reason })
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.message ?? res.statusText);
			await invalidate('app:review');
			reason = '';
			open = false;
		} catch (err) {
			error = (err as Error).message;
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="gap-5 p-5 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="text-base">Override the verdict</Dialog.Title>
			<Dialog.Description>
				The rules put this PR at <VerdictChip verdict={floor} class="mx-0.5 align-middle" />. Only a
				person can move it lower, and the reason is recorded on the review.
			</Dialog.Description>
		</Dialog.Header>
		<form class="grid gap-4" onsubmit={save}>
			<RadioGroup.Root bind:value={verdict} class="grid gap-1.5">
				{#each verdicts as v (v.value)}
					<label
						class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ring-1 ring-border transition-colors has-[[data-state=checked]]:bg-muted has-[[data-state=checked]]:ring-foreground/20"
					>
						<RadioGroup.Item value={v.value} />
						<VerdictChip verdict={v.value} />
						<span class="text-xs text-muted-foreground">{v.hint}</span>
					</label>
				{/each}
			</RadioGroup.Root>
			<Field.Field>
				<Field.Label for="override-reason">Reason</Field.Label>
				<Textarea
					id="override-reason"
					bind:value={reason}
					rows={3}
					placeholder="What did you check that the tool couldn't?"
				/>
				<Field.Description
					>At least 10 characters. Shown to everyone who opens this review.</Field.Description
				>
			</Field.Field>
			{#if error}<p role="alert" class="text-xs text-destructive">{error}</p>{/if}
			<Dialog.Footer>
				<Dialog.Close>
					{#snippet child({ props })}
						<Button variant="ghost" {...props}>Cancel</Button>
					{/snippet}
				</Dialog.Close>
				<Button type="submit" class="pressable" disabled={saving || reason.trim().length < 10}>
					{#if saving}<Loader2Icon class="animate-spin" />{/if}
					Record override
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
