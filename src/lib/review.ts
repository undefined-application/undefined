// PR review shapes (plan §5 Tab 4, §6.2 `GET /api/reviews/{id}`). Shared by server and pages.

import type { Claim, Person } from '$lib/claims';
import type { PullSummary } from '$lib/github';

export type Verdict = 'SAFE' | 'RISKY' | 'DANGEROUS' | 'STOP';
export type CompletenessLevel = 'complete' | 'partial' | 'insufficient';
export type ReviewStatus = 'queued' | 'running' | 'done' | 'failed';

export const VERDICT_RANK: Record<Verdict, number> = { SAFE: 0, RISKY: 1, DANGEROUS: 2, STOP: 3 };
export const maxVerdict = (a: Verdict, b: Verdict) => (VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b);

/** A rule from the deterministic floor that fired, with what triggered it. */
export interface RuleHit {
	rule: string;
	verdict: Verdict;
	detail: string;
}

export interface Finding {
	severity: Verdict | 'INFO';
	title: string;
	claims: Claim[];
	/** The person to ask about this code (Ask-the-author). */
	ask?: Person;
}

export type ChangeClass = 'comment_whitespace' | 'log_string' | 'docs' | 'code';

export interface TouchedSymbol {
	id: string;
	name: string;
	path: string;
	start: number;
	end: number;
	level: 'high' | 'medium' | 'low';
	score: number;
	/** `base`: exists at the merge base (changed or removed); `head`: added by the PR. */
	side: 'base' | 'head';
}

export interface ImpactNode {
	id: string;
	label: string;
	path: string | null;
	depth: number;
	/** Weakest link on the path from the touched code. */
	resolution: 'resolved' | 'ambiguous' | 'unresolved';
	/** Outside the deep scope (found by the reference index). */
	boundary: boolean;
}

/** One row of the display diff (GitHub-style, with context). Line numbers are 1-based. */
export interface DiffLine {
	kind: 'ctx' | 'add' | 'del';
	old: number | null;
	new: number | null;
	text: string;
}

export interface DiffFile {
	path: string;
	status: 'added' | 'deleted' | 'modified';
	binary: boolean;
	additions: number;
	deletions: number;
	hunks: { header: string; lines: DiffLine[] }[];
	/** Rows were cut to keep the stored review small. */
	truncated: boolean;
}

export interface ReviewResult {
	pull: PullSummary;
	/**
	 * The PR's diff (merge base → head, 3 lines of context) for the Files changed view.
	 * Missing on reviews stored before it existed.
	 */
	diff?: DiffFile[];
	/** Pinned commits (plan §5 Tab 4 step 1). */
	snapshots: { mergeBase: string; base: string; head: string; mergeBaseDiffers: boolean };
	scope: { deepScope: string; fromScan: string | null };
	changeClass: {
		overall: 'behaviour_free' | 'code';
		files: { path: string; class: ChangeClass }[];
	};
	/** Engine verdict: the floor, possibly raised (never lowered) by the LLM. */
	verdict: Verdict;
	floor: Verdict;
	floorReasons: RuleHit[];
	completeness: { level: CompletenessLevel; reasons: string[] };
	touched: TouchedSymbol[];
	impact: {
		nodes: ImpactNode[];
		edges: { from: string; to: string; resolution: 'resolved' | 'ambiguous' | 'unresolved' }[];
		counts: { resolved: number; ambiguous: number; unresolved: number; boundary: number };
	};
	tests: { related: { path: string; symbols: string[] }[]; missing: string[]; note: string };
	findings: Finding[];
	openQuestions: Claim[];
	rationale: { text: string; source: 'llm' | 'rules' };
	/** Assumptions the touched code relies on (timing, HW) that this PR may break. */
	assumptions: Claim[];
	llm: { used: boolean; model?: string; tokens?: number; downgrades: number; error?: string };
	stats: { files: number; hunks: number; ms: number };
}

export interface Override {
	verdict: Verdict;
	reason: string;
	user: string;
	at: string;
}

export interface ReviewSummary {
	id: string;
	repo: string;
	prNumber: number;
	title: string;
	status: ReviewStatus;
	stage: string | null;
	error: string | null;
	/** Final verdict: the latest override if any, else the engine's. */
	verdict: Verdict | null;
	engineVerdict: Verdict | null;
	createdAt: string;
	finishedAt: string | null;
	result: ReviewResult | null;
	overrides: Override[];
}
