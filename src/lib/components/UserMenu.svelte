<script lang="ts">
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import * as Avatar from '$lib/components/ui/avatar';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

	interface Props {
		user: { name: string; email: string; image?: string | null; guest?: boolean };
	}

	let { user }: Props = $props();

	const initials = $derived(
		user.name
			.split(/\s+/)
			.map((p) => p[0])
			.join('')
			.slice(0, 2)
			.toUpperCase() || '?'
	);

	// Server-side sign-out (POST /logout): clears the session and always lands on a fresh /login.
	let logoutForm = $state<HTMLFormElement>();
</script>

<form bind:this={logoutForm} method="POST" action="/logout" data-sveltekit-reload hidden></form>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="pressable rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
		aria-label="Account"
	>
		<Avatar.Root class="size-7">
			{#if user.image}<Avatar.Image src={user.image} alt="" />{/if}
			<Avatar.Fallback class="text-[10px] font-medium">{initials}</Avatar.Fallback>
		</Avatar.Root>
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-56">
		<DropdownMenu.Label class="grid gap-0.5">
			<span class="truncate text-xs font-medium text-foreground">{user.name}</span>
			<span class="truncate text-[11px] font-normal text-muted-foreground">
				{user.guest ? 'No account, public repositories only' : user.email}
			</span>
		</DropdownMenu.Label>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onSelect={() => logoutForm?.requestSubmit()}>
			<LogOutIcon />
			{user.guest ? 'Leave guest mode' : 'Sign out'}
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
