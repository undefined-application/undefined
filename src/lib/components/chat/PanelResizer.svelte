<script lang="ts">
	// The grip on the line between the page and the chat side panel: drag it anywhere along the
	// line, double-click for the default width, or focus it and use the arrow keys.
	import { CHAT_WIDTH, chatPanel } from '$lib/components/shell.svelte';
	import { cn } from '$lib/utils';

	let handle = $state<HTMLDivElement>();
	let dragging = $state(false);

	/** The panel's right edge: its width is the distance from there to the pointer. */
	const rightEdge = () => handle?.parentElement?.getBoundingClientRect().right ?? window.innerWidth;

	function start(e: PointerEvent) {
		if (e.button !== 0) return;
		e.preventDefault();
		handle?.setPointerCapture(e.pointerId);
		dragging = true;
		// The whole page shows the resize cursor and nothing gets selected on the way.
		document.documentElement.style.cursor = 'col-resize';
		document.documentElement.style.userSelect = 'none';
	}

	function move(e: PointerEvent) {
		if (dragging) chatPanel.resize(rightEdge() - e.clientX);
	}

	function end(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		handle?.releasePointerCapture(e.pointerId);
		document.documentElement.style.removeProperty('cursor');
		document.documentElement.style.removeProperty('user-select');
		chatPanel.resize(chatPanel.width, true);
	}

	function key(e: KeyboardEvent) {
		const step = e.shiftKey ? 64 : 16;
		const to =
			e.key === 'ArrowLeft'
				? chatPanel.width + step
				: e.key === 'ArrowRight'
					? chatPanel.width - step
					: e.key === 'Home'
						? chatPanel.maxWidth
						: e.key === 'End'
							? CHAT_WIDTH.min
							: null;
		if (to === null) return;
		e.preventDefault();
		chatPanel.resize(to, true);
	}
</script>

<!-- A focusable separator with a value is the ARIA window-splitter pattern, an interactive widget. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	bind:this={handle}
	role="separator"
	aria-orientation="vertical"
	aria-label="Resize chat panel"
	aria-valuenow={chatPanel.width}
	aria-valuemin={CHAT_WIDTH.min}
	aria-valuemax={chatPanel.maxWidth}
	tabindex="0"
	title="Drag to resize, double-click to reset"
	class="group absolute inset-y-0 left-0 z-20 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none"
	onpointerdown={start}
	onpointermove={move}
	onpointerup={end}
	onpointercancel={end}
	ondblclick={() => chatPanel.resize(CHAT_WIDTH.default, true)}
	onkeydown={key}
>
	<!-- The line lights up where it can be grabbed. -->
	<span
		class={cn(
			'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150',
			dragging ? 'bg-foreground/40' : 'group-hover:bg-foreground/25 group-focus-visible:bg-ring'
		)}
	></span>
	<!-- The grip, halfway down. -->
	<span
		class={cn(
			'absolute top-1/2 left-1/2 h-9 w-1.5 -translate-1/2 rounded-full ring-1 ring-background transition-colors duration-150',
			dragging
				? 'bg-foreground/60'
				: 'bg-border group-hover:bg-foreground/40 group-focus-visible:bg-ring'
		)}
	></span>
</div>
