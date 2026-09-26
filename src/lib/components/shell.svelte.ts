// UI state shared between the top bar and the system layout.

import { MediaQuery } from 'svelte/reactivity';
import { innerWidth } from 'svelte/reactivity/window';

const SPLIT_KEY = 'undefined:chat-split';
const WIDTH_KEY = 'undefined:chat-width';
const NAV_KEY = 'undefined:nav-collapsed';

/** Side panel width: 26rem by default, at least 20rem, and the page keeps 30rem next to the sidebar. */
export const CHAT_WIDTH = { default: 416, min: 320, max: 960 };
const SIDEBAR = 240;
const MIN_PAGE = 480;

function load(key: string) {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
	} catch {
		return null;
	}
}

function save(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Private mode: the choice just isn't remembered.
	}
}

export const shell = $state({
	/** The system sidebar as a sheet, below `lg`. */
	navOpen: false,
	/** The chat as a side panel instead of the dock (a remembered preference). */
	chatSplit: load(SPLIT_KEY) === '1',
	/** The side panel's width as dragged (px); `chatPanel.width` fits it to the window. */
	chatWidth: Number(load(WIDTH_KEY)) || CHAT_WIDTH.default,
	/** Set once the system layout has mounted, so the split never differs from the server render. */
	hydrated: false,
	/** The system sidebar folded away, `lg` and up (a remembered preference). */
	navCollapsed: load(NAV_KEY) === '1',
	/** The same while the chat is a side panel: folds every time the panel opens. */
	navCollapsedSplit: true,
	/** The folded sidebar shown floating while the pointer is near it. */
	navPeek: false,
	/** Past the first paint after hydration: from here on the sidebar animates as it folds. */
	settled: false
});

// The side panel needs room next to the sidebar and the page: `xl` and up.
const wide = new MediaQuery('min-width: 80rem', false);

export const chatPanel = {
	/** Whether the panel can be offered on this screen. */
	get available() {
		return shell.hydrated && wide.current;
	},
	/** The chat is a side panel right now (else it's the dock). */
	get open() {
		return shell.chatSplit && this.available;
	},
	set(split: boolean) {
		shell.chatSplit = split;
		save(SPLIT_KEY, split ? '1' : '0');
		// The chat takes the sidebar's room: it folds, and comes back as it was when the chat leaves.
		if (split) shell.navCollapsedSplit = true;
		shell.navPeek = false;
	},
	/** The widest the panel may be in this window. */
	get maxWidth() {
		const room = (innerWidth.current ?? 1440) - (nav.collapsed ? 0 : SIDEBAR) - MIN_PAGE;
		return Math.max(CHAT_WIDTH.min, Math.min(CHAT_WIDTH.max, room));
	},
	/** The width to render: the dragged width, fitted to the window. */
	get width() {
		return Math.min(Math.max(shell.chatWidth, CHAT_WIDTH.min), this.maxWidth);
	},
	/** Resize (clamped); `persist` once the drag ends. */
	resize(width: number, persist = false) {
		shell.chatWidth = Math.round(Math.min(Math.max(width, CHAT_WIDTH.min), this.maxWidth));
		if (persist) save(WIDTH_KEY, String(shell.chatWidth));
	}
};

/** The system sidebar, `lg` and up: docked, or folded away and shown on hover. */
export const nav = {
	/** Docked until the layout has mounted, like the server render. */
	get collapsed() {
		if (!shell.hydrated) return false;
		return chatPanel.open ? shell.navCollapsedSplit : shell.navCollapsed;
	},
	toggle() {
		const collapsed = !this.collapsed;
		if (chatPanel.open) shell.navCollapsedSplit = collapsed;
		else {
			shell.navCollapsed = collapsed;
			save(NAV_KEY, collapsed ? '1' : '0');
		}
		clearTimeout(peekTimer);
		shell.navPeek = false;
	},
	/**
	 * Show or hide the folded sidebar as the pointer comes and goes. It opens a beat after the
	 * pointer arrives, so passing over the edge doesn't flash it, and closes a beat after it leaves,
	 * so crossing from the edge into the panel doesn't close it.
	 */
	peek(show: boolean) {
		clearTimeout(peekTimer);
		if (show && !this.collapsed) return;
		peekTimer = setTimeout(() => (shell.navPeek = show), show ? 60 : 200);
	}
};

let peekTimer: ReturnType<typeof setTimeout> | undefined;
