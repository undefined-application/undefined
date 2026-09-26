// The model's reading of one "What not to break" fence: what it protects against, what breaks
// without it, what to check first. Deterministic analysis picks the lines and sets the verdict;
// the model only interprets the evidence it is given, and every claim is validated against
// exactly that evidence (plan §4.5.5). Cached by input hash, so a second visit is free.

import type { Citation } from '$lib/claims';
import type { Fence, FenceReading } from '$lib/model';
import { validateClaims, type EvidenceItem } from '$lib/server/evidence/validate';
import { parseJsonAll, type Llm } from '$lib/server/llm/core';
import { git } from './git';
import type { SnapshotView } from './views';

export const PROMPT_ID = 'fence-reading.v2';

/** Longest slice of the enclosing function sent as context. */
const FN_LINES = 160;
const MESSAGE_CHARS = 1500;

const SYSTEM = `You explain one guard in a legacy embedded C/C++ codebase to an engineer who is about to change it.
Deterministic analysis already found it: its lines, the function around them and the commit messages that
shaped them, given as evidence items E1..En. Rules set the verdict for changing it; you don't.

Answer in plain words, one or two short sentences each:
- protects: what hardware, timing or data problem these lines guard against.
- if_removed: what would likely go wrong if someone removed or "simplified" them.
- before_changing: what to check or test first (which chip, board, rate or condition).
- question: one thing the evidence cannot answer that the author should confirm, or null.

Rules, all mandatory:
- Cite ONLY evidence ids from the packet in "cite". Never invent ids, SHAs, paths or quotes.
- "verified" ONLY when a cited item states it directly (the code does X; a commit message or comment
  says Y). basis must then be code_fact, commit_statement or comment_statement.
- Consequences and intent are "inferred" (with confidence) unless a commit message or comment states them.
- If the evidence does not say, use "unknown". Prefer unknown to guessing.
- "quote", when given, must be copied exactly from the cited item.

Reply with exactly one JSON object and nothing else, shaped like this example:
{"protects": {"text": "...", "status": "verified", "basis": "commit_statement", "cite": ["E3"], "quote": "..."},
 "if_removed": {"text": "...", "status": "inferred", "confidence": "medium", "basis": "inference", "cite": ["E1", "E3"]},
 "before_changing": {"text": "...", "status": "inferred", "confidence": "low", "basis": "inference", "cite": ["E1"]},
 "question": "..."}
status is verified, inferred or unknown; confidence is low, medium or high (inferred only); basis is
code_fact, commit_statement, comment_statement or inference; quote is optional.`;

const PARTS = ['protects', 'if_removed', 'before_changing'] as const;
type Part = (typeof PARTS)[number];

/**
 * The claims in a response, as asked (`{"protects": {claim}, ...}`) or as models often answer:
 * one flat object per part (`{"protects": "text", "status": ..., "cite": [...]}`), possibly
 * split over several top-level objects.
 */
export function partsOf(text: string): {
	claims: Partial<Record<Part, unknown>>;
	question: unknown;
} {
	const claims: Partial<Record<Part, unknown>> = {};
	let question: unknown = null;
	for (const obj of parseJsonAll<Record<string, unknown>>(text)) {
		if (!obj || typeof obj !== 'object') continue;
		for (const part of PARTS) {
			const v = obj[part];
			if (claims[part] || v == null) continue;
			if (typeof v === 'object') claims[part] = v;
			else if (typeof v === 'string') claims[part] = { ...obj, text: v };
		}
		if (question == null && obj.question != null) question = obj.question;
	}
	return { claims, question };
}

export async function readFence(
	fence: Fence,
	m: SnapshotView,
	dir: string,
	llm: Llm
): Promise<FenceReading & { tokens: number }> {
	const src = (await git(['show', `${m.commit}:${fence.path}`], { cwd: dir })).split('\n');
	const evidence: EvidenceItem[] = [];
	const add = (citation: Citation, text: string) =>
		evidence.push({ id: `E${evidence.length + 1}`, citation, text });
	const code = (start: number, end: number): Citation => ({
		kind: 'code',
		commit: m.commit,
		path: fence.path,
		start,
		end
	});
	const lines = (start: number, end: number) => src.slice(start - 1, end).join('\n');

	add(code(fence.start, fence.end), lines(fence.start, fence.end));
	const fn = m.symbols.find((s) => s.id === fence.fn.id);
	if (fn) {
		const end = Math.min(fn.end, fn.start + FN_LINES - 1);
		add(code(fn.start, end), lines(fn.start, end));
	}
	const commits = [fence.origin, fence.reverted?.change, fence.reverted?.revert].filter(
		(c, i, all): c is NonNullable<typeof c> => !!c && all.findIndex((x) => x?.sha === c.sha) === i
	);
	for (const c of commits) {
		const message = (await git(['show', '-s', '--format=%B', c.sha], { cwd: dir })).trim();
		add(
			{ kind: 'commit', sha: c.sha, subject: c.subject },
			`${c.author}, ${c.date.slice(0, 10)}:\n${message.slice(0, MESSAGE_CHARS)}`
		);
	}

	const user = [
		`Repo ${m.repo} at ${m.commit.slice(0, 10)}. Function ${fence.fn.name} in ${fence.path}.`,
		`Guarded lines ${fence.start}-${fence.end}. Rule verdict if changed: ${fence.verdict} (${fence.because.join('; ')}).`,
		fence.reverted ? `A change to these lines was reverted ${fence.reverted.days} days later.` : '',
		fence.alsoIn.length
			? `The same guard is copied in: ${fence.alsoIn.map((a) => a.fn).join(', ')}.`
			: '',
		'',
		'Evidence packet:',
		...evidence.map((e) => {
			const where =
				e.citation.kind === 'code'
					? `code ${e.citation.path}:${e.citation.start}-${e.citation.end}`
					: `commit ${e.citation.sha.slice(0, 10)}`;
			return `${e.id} [${where}]\n${e.text}`;
		})
	]
		.filter((l, i, all) => l !== '' || all[i - 1] !== '')
		.join('\n');

	const res = await llm.chat({
		tier: 'strong',
		promptId: PROMPT_ID,
		maxTokens: 1500,
		messages: [
			{ role: 'system', content: SYSTEM },
			{ role: 'user', content: user }
		]
	});
	const { claims, question } = partsOf(res.text);
	if (!PARTS.some((p) => claims[p])) throw new Error('the model returned no reading');

	let downgrades = 0;
	const claim = (raw: unknown) => {
		if (!raw) return null;
		const v = validateClaims([raw], evidence);
		downgrades += v.downgrades.length;
		return v.claims[0] ?? null;
	};
	return {
		protects: claim(claims.protects),
		ifRemoved: claim(claims.if_removed),
		beforeChanging: claim(claims.before_changing),
		question: typeof question === 'string' && question.trim() ? question.trim() : null,
		model: res.model,
		cached: res.cached,
		downgrades,
		tokens: res.promptTokens + res.completionTokens
	};
}
