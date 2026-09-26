<script lang="ts">
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { resetMode, setMode, userPrefersMode } from 'mode-watcher';
	import { buttonVariants } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { cn } from '$lib/utils';

	let { class: className }: { class?: string } = $props();

	const options = [
		{ value: 'light', label: 'Light', icon: SunIcon },
		{ value: 'dark', label: 'Dark', icon: MoonIcon },
		{ value: 'system', label: 'System', icon: MonitorIcon }
	] as const;

	function pick(value: string) {
		// Ease the colour change instead of flashing (apple-design §14).
		document.documentElement.classList.add('theme-transition');
		if (value === 'system') resetMode();
		else setMode(value as 'light' | 'dark');
		setTimeout(() => document.documentElement.classList.remove('theme-transition'), 250);
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class={cn(
			buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
			"size-7.5 [&_svg:not([class*='size-'])]:size-4",
			className
		)}
		aria-label="Theme"
	>
		<SunIcon class="scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
		<MoonIcon
			class="absolute scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0"
		/>
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-36">
		<DropdownMenu.RadioGroup value={userPrefersMode.current} onValueChange={pick}>
			{#each options as o (o.value)}
				<DropdownMenu.RadioItem value={o.value}>
					<o.icon />
					{o.label}
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.Content>
</DropdownMenu.Root>
