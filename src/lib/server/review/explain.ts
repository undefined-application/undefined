// Optional LLM step for a review: a rationale paragraph plus extra claims, validated against the
// evidence packet (plan §4.5.5). It may raise the verdict with cited reasons, never lower it.

import type { Claim } from '$lib/claims';
import { maxVerdict, VERDICT_RANK, type Verdict } from '$lib/review';
import { validateClaims } from '$lib/server/evidence/validate';
import { parseJsonLoose, type Llm } from '$lib/server/llm/core';
import type { PullAnalysis } from './engine';

export const PROMPT_ID = 'review-rationale.v1';

const SYSTEM = `You review a pull request to a legacy embedded C/C++ codebase for a team that must not break
safety-, timing- or hardware-critical behaviour. You get deterministic analysis results and an evidence
packet of items E1..En (code at a pinned commit, commit messages, comments).

Rules, all mandatory:
- Cite ONLY evidence item ids from the packet, in "cite". Never invent ids, SHAs, paths or quotes.
- status "verified" ONLY for facts an item states directly (the code does X; a commit message says Y).
  basis must then be code_fact, commit_statement or comment_statement.
- Why the code exists / what it protects against is "inferred" (with confidence) unless a commit
  message or comment states it, in which case it is verified with that citation.
- If the evidence does not answer something, say so with status "unknown". Prefer unknown to guessing.
- "quote", when given, must be copied exactly from the cited item.
- You may argue for a HIGHER verdict than the rule floor, never a lower one.

Reply with one JSON object and nothing else:
{"verdict":"SAFE|RISKY|DANGEROUS|STOP","rationale":"one paragraph for the PR author",
 "claims":[{"text":"...","status":"verified|inferred|unknown","confidence":"low|medium|high","basis":"code_fact|commit_statement|comment_statement|inference","cite":["E1"],"quote":"optional"}],
 "open_questions":["what the evidence cannot answer and a human must"]}`;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export async function explainWithLlm(analysis: PullAnalysis, llm: Llm): Promise<void> {
	const { result, evidence } = analysis;
	const user = [
		`PR #${result.pull.number}: ${result.pull.title}`,
		`Rule floor: ${result.floor}`,
		...result.floorReasons.map((r) => `- ${r.verdict} ${r.rule}: ${r.detail}`),
		`Analysis completeness: ${result.completeness.level}${result.completeness.reasons.length ? ` (${result.completeness.reasons.join('; ')})` : ''}`,
		`Change class: ${result.changeClass.files.map((f) => `${f.path}=${f.class}`).join(', ')}`,
		`Touched: ${result.touched.map((t) => `${t.name} [${t.side}, criticality ${t.level}]`).join(', ') || 'none'}`,
		`Dependents: ${result.impact.nodes.length} (${result.impact.counts.ambiguous} ambiguous, ${result.impact.counts.boundary} outside scope)`,
		`Related tests: ${result.tests.related.length}`,
		'',
		'Evidence packet:',
		...evidence.map((e) => {
			const where =
				e.citation.kind === 'code'
					? `code ${e.citation.path}:${e.citation.start}-${e.citation.end} @${e.citation.commit.slice(0, 10)}`
					: `commit ${e.citation.sha.slice(0, 10)}`;
			return `${e.id} [${where}]\n${clip(e.text, 1200)}`;
		})
	].join('\n');

	const res = await llm.chat({
		tier: 'strong',
		promptId: PROMPT_ID,
		maxTokens: 3000,
		messages: [
			{ role: 'system', content: SYSTEM },
			{ role: 'user', content: user }
		]
	});
	const out = parseJsonLoose<{
		verdict?: string;
		rationale?: unknown;
		claims?: unknown;
		open_questions?: unknown;
	}>(res.text);
	const { claims, downgrades } = validateClaims(out.claims, evidence);

	const proposed = (out.verdict ?? '').toUpperCase() as Verdict;
	// Raising needs at least one surviving cited claim; lowering is ignored (plan §5 step 8).
	const cited = claims.some((c) => c.status !== 'unknown');
	if (proposed in VERDICT_RANK && cited) result.verdict = maxVerdict(result.floor, proposed);

	if (typeof out.rationale === 'string' && out.rationale.trim()) {
		result.rationale = { text: clip(out.rationale.trim(), 1500), source: 'llm' };
	}
	if (claims.length)
		result.findings.push({ severity: 'INFO', title: 'Model analysis (validated)', claims });
	const ask = result.findings.find((f) => f.ask)?.ask;
	if (Array.isArray(out.open_questions)) {
		for (const q of out.open_questions.slice(0, 5)) {
			if (typeof q !== 'string' || !q.trim()) continue;
			const claim: Claim = {
				text: q.trim(),
				status: 'unknown',
				basis: 'inference',
				citations: [],
				ask
			};
			result.openQuestions.push(claim);
		}
	}
	result.llm = {
		used: true,
		model: res.model,
		tokens: res.promptTokens + res.completionTokens,
		downgrades: downgrades.length
	};
}
