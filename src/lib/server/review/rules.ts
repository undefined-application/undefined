// Plan §5 Tab 4 step 8: the deterministic rule floor. Computed before any LLM runs; the LLM may
// raise the verdict but never lower it; only a human override (with a reason) can.

import { maxVerdict, type CompletenessLevel, type RuleHit, type Verdict } from '$lib/review';
import type { LineHistoryEntry } from '$lib/server/scan/gitmine';

/** Commit messages that state a hardware anomaly / workaround explicitly (stricter than stage 2's rationale flag). */
export const EXPLICIT_WORKAROUND =
	/\b(errat(a|um)|silicon|work[- ]?arounds?|quirks?|glitch\w*|spurious|anomal\w*|alignment errors?|corrupt\w*|integrity|undocumented|chip rev\w*|hardware bug|hw bug|bad \w*\s?data)\b/i;

/** Signal kinds that make a touched line a timing / ISR / HW / interface contract (DANGEROUS). */
export const CONTRACT_SIGNALS = new Set([
	'isr',
	'timing',
	'timing_constant',
	'watchdog',
	'hw_access',
	'hw_register',
	'concurrency',
	'external_interface'
]);

/** 3 revert, 2 workaround stated in the subject, 1 only in the body, 0 none. */
export const strength = (e: LineHistoryEntry) =>
	e.revert ? 3 : EXPLICIT_WORKAROUND.test(e.subject) ? 2 : EXPLICIT_WORKAROUND.test(e.body) ? 1 : 0;

/** Split a line history into explicit-workaround and bug-fix/rationale commits, and pick the key one. */
export function keyCommits(entries: LineHistoryEntry[]) {
	const strong = entries
		.filter((e) => strength(e) > 0)
		.sort((a, b) => strength(b) - strength(a) || a.authoredAt - b.authoredAt);
	const weak = entries.filter((e) => strength(e) === 0 && (e.bugfix || e.rationale));
	return { strong, weak, key: strong[0] ?? weak[0] ?? null };
}

export interface HistoryHit {
	/** Where: `path:start-end` at the merge base. */
	where: string;
	sha: string;
	subject: string;
	revert: boolean;
	bugfix: boolean;
	rationale: boolean;
	/** Message states the workaround explicitly (`EXPLICIT_WORKAROUND`). */
	explicit: boolean;
}

export interface RuleInput {
	/** Every changed file is comment/whitespace/log-string/docs only. */
	behaviourFree: boolean;
	/** Line history of changed or removed code lines (merge base). */
	history: HistoryHit[];
	/** Changed/removed lines sitting under a workaround comment (`path:line` → comment). */
	workaroundComments: { where: string; comment: string }[];
	/** Signals on changed/removed/added lines. */
	signals: { where: string; kind: string }[];
	/** Touched existing symbols. */
	touched: { name: string; level: 'high' | 'medium' | 'low' }[];
	completeness: CompletenessLevel;
	relatedTests: number;
}

export function ruleFloor(input: RuleInput): { floor: Verdict; reasons: RuleHit[] } {
	const reasons: RuleHit[] = [];
	const hit = (rule: string, verdict: Verdict, detail: string) =>
		reasons.push({ rule, verdict, detail });

	if (input.behaviourFree) {
		hit(
			'change_class',
			'SAFE',
			'Only comments, whitespace, log/message strings or docs change: no behaviour change.'
		);
		return { floor: 'SAFE', reasons };
	}

	// STOP: altering or removing an explicit workaround / errata fix.
	for (const h of input.history) {
		if (h.revert)
			hit(
				'reverted_before',
				'STOP',
				`${h.where}: its history includes a revert (${h.sha.slice(0, 10)} "${h.subject}")`
			);
		else if (h.explicit)
			hit(
				'explicit_workaround',
				'STOP',
				`${h.where}: shaped by ${h.sha.slice(0, 10)} "${h.subject}"`
			);
	}
	for (const w of input.workaroundComments) {
		hit('workaround_comment', 'STOP', `${w.where}: under the comment "${w.comment}"`);
	}

	// DANGEROUS: bug-fix history, or a timing / ISR / HW register / external interface contract.
	for (const h of input.history) {
		if (!h.revert && !h.explicit && (h.bugfix || h.rationale)) {
			hit(
				'bugfix_history',
				'DANGEROUS',
				`${h.where}: shaped by ${h.bugfix ? 'bug-fix' : 'HW/timing'} commit ${h.sha.slice(0, 10)} "${h.subject}"`
			);
		}
	}
	const contract = input.signals.filter((s) => CONTRACT_SIGNALS.has(s.kind));
	for (const kind of new Set(contract.map((s) => s.kind))) {
		const where = contract.filter((s) => s.kind === kind).map((s) => s.where);
		hit(
			'contract_signal',
			'DANGEROUS',
			`${kind} on ${where.slice(0, 3).join(', ')}${where.length > 3 ? ` (+${where.length - 3})` : ''}`
		);
	}

	// RISKY: callers only partly known, critical code touched, or no related tests.
	if (input.completeness !== 'complete' && input.touched.length > 0) {
		hit('incomplete_analysis', 'RISKY', `analysis completeness is ${input.completeness}`);
	}
	const critical = input.touched.filter((t) => t.level !== 'low');
	if (critical.length > 0) {
		hit(
			'critical_symbol',
			'RISKY',
			critical
				.map((t) => `${t.name} (${t.level})`)
				.slice(0, 4)
				.join(', ')
		);
	}
	if (input.relatedTests === 0)
		hit('no_related_tests', 'RISKY', 'no test references the touched code');

	const floor = reasons.reduce<Verdict>((v, r) => maxVerdict(v, r.verdict), 'SAFE');
	if (reasons.length === 0)
		hit('no_rule', 'SAFE', 'complete analysis, no critical signals, related tests found');
	return { floor, reasons };
}
