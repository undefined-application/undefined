<script lang="ts" module>
	import DOMPurify from 'dompurify';
	import { Marked } from 'marked';

	// Evidence ids the model cites inline ([E1], [E2]…) become small markers instead of brackets.
	const md = new Marked({
		gfm: true,
		breaks: true,
		extensions: [
			{
				name: 'evidence',
				level: 'inline',
				start: (src) => src.match(/\[E\d+\]/)?.index,
				tokenizer(src) {
					const m = /^\[(E\d+)\]/.exec(src);
					if (m) return { type: 'evidence', raw: m[0], id: m[1] };
				},
				renderer: (token) => `<sup class="evidence">${token.id}</sup>`
			}
		]
	});

	function escape(text: string) {
		return text.replace(
			/[&<>"']/g,
			(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
		);
	}

	/** Model output is untrusted: parse, then sanitise. Without a DOM (SSR) fall back to plain text. */
	function render(text: string) {
		if (!DOMPurify.isSupported) return `<p>${escape(text)}</p>`;
		// No images: they would only fetch URLs the model made up.
		return DOMPurify.sanitize(md.parse(text, { async: false }), { FORBID_TAGS: ['img'] });
	}
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		text: string;
		class?: string;
	}

	let { text, class: className }: Props = $props();

	const html = $derived(render(text));
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised by DOMPurify above -->
<div class={cn('markdown', className)}>{@html html}</div>

<style>
	.markdown :global(> * + *) {
		margin-top: 0.75em;
	}
	.markdown :global(:is(h1, h2, h3, h4)) {
		font-weight: 600;
		font-size: 1em;
		margin-top: 1.1em;
	}
	.markdown :global(strong) {
		font-weight: 600;
	}
	.markdown :global(:is(ul, ol)) {
		padding-left: 1.4em;
	}
	.markdown :global(ul) {
		list-style: disc;
	}
	.markdown :global(ol) {
		list-style: decimal;
	}
	.markdown :global(li + li),
	.markdown :global(li > :is(ul, ol)) {
		margin-top: 0.35em;
	}
	.markdown :global(li::marker) {
		color: var(--muted-foreground);
	}
	.markdown :global(a) {
		color: var(--link);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	/* Inline code is an identifier or a path: Plex Sans, like the claims' chips (ui-spec §5 Type).
	   Only code blocks, which are source, are mono. */
	.markdown :global(code) {
		font-size: 0.88em;
		padding: 0.1em 0.3em;
		border-radius: var(--radius-sm);
		background: var(--muted);
		overflow-wrap: anywhere;
	}
	.markdown :global(pre) {
		overflow-x: auto;
		padding: 0.75em 0.9em;
		border-radius: var(--radius-md);
		background: var(--muted);
		font-size: 0.9em;
		line-height: 1.5;
	}
	.markdown :global(pre code) {
		font-family: var(--font-mono);
		padding: 0;
		background: none;
		font-size: inherit;
		overflow-wrap: normal;
	}
	.markdown :global(blockquote) {
		padding-left: 0.9em;
		border-left: 2px solid var(--border);
		color: var(--muted-foreground);
	}
	.markdown :global(table) {
		display: block;
		overflow-x: auto;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}
	.markdown :global(:is(th, td)) {
		padding: 0.3em 0.7em;
		border: 1px solid var(--border);
		text-align: left;
	}
	.markdown :global(th) {
		font-weight: 600;
	}
	.markdown :global(hr) {
		border-color: var(--border);
	}
	.markdown :global(.evidence) {
		margin-left: 0.1em;
		font-size: 0.72em;
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}
</style>
