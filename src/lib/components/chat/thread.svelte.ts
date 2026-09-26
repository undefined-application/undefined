// The chats about one scan: every conversation you've had with it, one of them active. Kept while
// you move between the wiki, the graph and pull requests, and in the browser (localStorage; a
// convenience, the server keeps nothing).

import { apiFetch } from '$lib/api';
import type { Claim } from '$lib/claims';

/** A passage from an earlier message the user is replying to. */
export interface Quote {
	from: 'user' | 'assistant';
	text: string;
}

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
	quote?: Quote;
	claims?: Claim[];
	steps?: { tool: string; args: Record<string, unknown> }[];
	downgrades?: number;
	model?: string;
	error?: boolean;
}

/** One conversation: its messages, newest activity first in the list. */
export interface Conversation {
	id: string;
	createdAt: number;
	updatedAt: number;
	messages: ChatMessage[];
}

const key = (scanId: string) => `undefined:chats:${scanId}`;
/** Where a single thread per scan used to live (sessionStorage); imported once. */
const legacyKey = (scanId: string) => `undefined:chat:${scanId}`;
const MAX_QUOTE = 1500;
const MAX_CONVERSATIONS = 50;

const newId = () =>
	typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** The first question, as the conversation's name. */
export function titleOf(c: Conversation) {
	const first = c.messages.find((m) => m.role === 'user')?.content.trim() ?? '';
	return first.replace(/\s+/g, ' ') || 'New conversation';
}

/** What the model sees: the quote as a markdown blockquote above the question. */
function withQuote({ content, quote }: ChatMessage) {
	if (!quote) return content;
	const quoted = quote.text
		.split('\n')
		.map((line) => `> ${line}`)
		.join('\n');
	const who = quote.from === 'assistant' ? 'your earlier answer' : 'my earlier message';
	return `Replying to this passage from ${who}:\n${quoted}\n\n${content}`;
}

function load(scanId: string): Conversation[] {
	try {
		const stored: Conversation[] = JSON.parse(localStorage.getItem(key(scanId)) ?? '[]');
		const legacy: ChatMessage[] = JSON.parse(sessionStorage.getItem(legacyKey(scanId)) ?? '[]');
		sessionStorage.removeItem(legacyKey(scanId));
		if (legacy.length) {
			const now = Date.now();
			stored.unshift({ id: newId(), createdAt: now, updatedAt: now, messages: legacy });
		}
		return stored;
	} catch {
		return [];
	}
}

function save(scanId: string, conversations: Conversation[]) {
	try {
		localStorage.setItem(key(scanId), JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)));
	} catch {
		// Private mode or quota: the chat still works, it just won't survive a reload.
	}
}

export class Thread {
	/** Every conversation about this scan, most recently active first. */
	conversations = $state<Conversation[]>([]);
	/** The conversation on screen; `null` is a fresh one, stored once its first question is sent. */
	activeId = $state<string | null>(null);
	/** The conversation waiting for an answer (one at a time). */
	pending = $state<string | null>(null);
	/** The thread panel above the composer. */
	open = $state(false);
	draft = $state('');
	/** The passage the next message replies to. */
	quote = $state<Quote | null>(null);
	/** Bumped to ask the composer to take focus. */
	focusRequest = $state(0);

	constructor(readonly scanId: string) {
		if (typeof localStorage === 'undefined') return;
		this.conversations = load(scanId);
		this.activeId = this.conversations[0]?.id ?? null;
		save(scanId, this.conversations);
	}

	get active(): Conversation | undefined {
		return this.conversations.find((c) => c.id === this.activeId);
	}

	get messages(): ChatMessage[] {
		return this.active?.messages ?? [];
	}

	/** The conversation on screen is waiting for an answer. */
	get sending() {
		return this.pending !== null && this.pending === this.activeId;
	}

	/** Some conversation is waiting for an answer; the next question has to wait. */
	get busy() {
		return this.pending !== null;
	}

	/** Start a fresh conversation (the current one stays in the list). */
	startNew() {
		this.activeId = null;
		this.quote = null;
		this.focus();
	}

	select(id: string) {
		this.activeId = id;
		this.quote = null;
		this.open = true;
	}

	remove(id: string) {
		this.conversations = this.conversations.filter((c) => c.id !== id);
		if (this.activeId === id) this.activeId = null;
		save(this.scanId, this.conversations);
	}

	/** Reply to `text` from an earlier message with the next question. */
	quoteText(text: string, from: Quote['from']) {
		const clean = text
			.replace(/\[E\d+\]/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
		if (!clean) return;
		this.quote = {
			from,
			text: clean.length > MAX_QUOTE ? `${clean.slice(0, MAX_QUOTE).trimEnd()}…` : clean
		};
		this.open = true;
		this.focus();
	}

	/** Send `text` (or the draft), replying to `quote` (or the pending quote). */
	async send(text = this.draft, quote = this.quote) {
		const content = text.trim();
		if (!content || this.busy) return;
		let conv = this.active;
		if (!conv) {
			const now = Date.now();
			this.conversations.unshift({ id: newId(), createdAt: now, updatedAt: now, messages: [] });
			conv = this.conversations[0];
			this.activeId = conv.id;
		}
		conv.messages.push(quote ? { role: 'user', content, quote } : { role: 'user', content });
		this.touch(conv);
		this.draft = '';
		this.quote = null;
		this.open = true;
		this.pending = conv.id;
		try {
			const res = await apiFetch(`/api/scans/${this.scanId}/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					messages: conv.messages
						.filter((m) => !m.error)
						.map((m) => ({ role: m.role, content: withQuote(m) }))
				})
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.message ?? res.statusText);
			conv.messages.push({
				role: 'assistant',
				content: body.answer,
				claims: body.claims,
				steps: body.steps,
				downgrades: body.downgrades,
				model: body.model
			});
		} catch (err) {
			conv.messages.push({ role: 'assistant', content: (err as Error).message, error: true });
		} finally {
			this.pending = null;
			this.touch(conv);
		}
	}

	/** Re-ask the last question after an error. */
	retry() {
		const conv = this.active;
		const lastUser = conv?.messages.findLastIndex((m) => m.role === 'user') ?? -1;
		if (!conv || lastUser < 0) return;
		const { content, quote } = conv.messages[lastUser];
		conv.messages = conv.messages.slice(0, lastUser);
		this.send(content, quote ?? null);
	}

	/** Mark `conv` as just used: first in the list, and saved. */
	private touch(conv: Conversation) {
		conv.updatedAt = Date.now();
		const i = this.conversations.indexOf(conv);
		if (i > 0) this.conversations.unshift(...this.conversations.splice(i, 1));
		save(this.scanId, this.conversations);
	}

	focus() {
		this.focusRequest++;
	}
}

// A plain registry: each Thread is reactive itself; the lookup table doesn't need to be.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const threads = new Map<string, Thread>();

export function threadFor(scanId: string): Thread {
	let thread = threads.get(scanId);
	if (!thread) {
		thread = new Thread(scanId);
		threads.set(scanId, thread);
	}
	return thread;
}
