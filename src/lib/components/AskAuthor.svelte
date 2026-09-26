<script lang="ts">
	// Plan §3 rule 3: "Ask the author" everywhere a line of code appears. It prepares the question
	// and opens mail or the GitHub profile; nothing is ever sent automatically.
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import MailIcon from '@lucide/svelte/icons/mail';
	import MessageCircleQuestionIcon from '@lucide/svelte/icons/message-circle-question-mark';
	import GithubMark from '$lib/components/brand/GithubMark.svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import type { Person } from '$lib/claims';
	import { cn } from '$lib/utils';

	interface Props {
		person: Person;
		repo: string;
		/** What the question is about, e.g. `AP_InertialSensor_Invensense.cpp:549`. */
		about?: string;
		question?: string;
		class?: string;
	}

	let { person, repo, about, question, class: className }: Props = $props();

	let copied = $state(false);

	const first = $derived(person.name.split(' ')[0]);
	const noreply = $derived(/noreply/i.test(person.email));
	const years = $derived(
		Math.floor((Date.now() - Date.parse(person.date)) / (365.25 * 24 * 3600 * 1000))
	);
	const text = $derived(
		question ??
			`Hi ${first}, I'm working on ${repo}${about ? ` (${about})` : ''}. ` +
				`Your commit ${person.sha.slice(0, 10)} ("${person.subject}") shaped this code. ` +
				`What problem does it protect against, and is it still needed?`
	);
	const mailto = $derived(
		`mailto:${person.email}?subject=${encodeURIComponent(`Question about ${repo}${about ? ` ${about}` : ''}`)}&body=${encodeURIComponent(
			`${text}\n\nCommit: https://github.com/${repo}/commit/${person.sha}`
		)}`
	);

	async function copy() {
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<Popover.Root>
	<Popover.Trigger
		class={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'pressable gap-1', className)}
	>
		<MessageCircleQuestionIcon />
		Ask author
	</Popover.Trigger>
	<Popover.Content align="end" class="w-80 gap-3 p-3">
		<div class="grid gap-0.5">
			<p class="text-[13px] font-medium text-foreground">{person.name}</p>
			<p class="truncate text-[11px] text-muted-foreground">
				{person.email}
				{#if person.login}
					<span aria-hidden="true">·</span>
					<a
						class="text-link hover:underline"
						href="https://github.com/{person.login}"
						target="_blank"
						rel="noreferrer">@{person.login}</a
					>
				{/if}
			</p>
			<p class="text-[11px] text-muted-foreground">
				<a
					class="text-link hover:underline"
					href="https://github.com/{repo}/commit/{person.sha}"
					target="_blank"
					rel="noreferrer">{person.sha.slice(0, 10)}</a
				>
				on {person.date.slice(0, 10)}
			</p>
		</div>
		{#if noreply || years >= 3}
			<ul class="grid gap-1 text-[11px] text-risky">
				{#if noreply}<li>GitHub noreply address: email won't reach them. Use the profile.</li>{/if}
				{#if years >= 3}<li>
						This commit is {years} years old. They may have left the project.
					</li>{/if}
			</ul>
		{/if}
		<p
			class="rounded-md bg-muted px-2.5 py-2 text-[12px] leading-relaxed text-foreground/90 ring-1 ring-border ring-inset"
		>
			{text}
		</p>
		<div class="flex flex-wrap gap-1.5">
			{#if !noreply}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- mailto:, not an app route -->
				<a href={mailto} class={cn(buttonVariants({ size: 'sm' }), 'pressable')}>
					<MailIcon />
					Email
				</a>
			{/if}
			{#if person.login}
				<a
					href="https://github.com/{person.login}"
					target="_blank"
					rel="noreferrer"
					class={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'pressable')}
				>
					<GithubMark class="size-3" />
					Profile
				</a>
			{/if}
			<Button variant="outline" size="sm" class="pressable" onclick={copy}>
				{#if copied}<CheckIcon />Copied{:else}<CopyIcon />Copy question{/if}
			</Button>
		</div>
	</Popover.Content>
</Popover.Root>
