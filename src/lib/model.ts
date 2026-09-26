// System-model shapes served to Tab 1 (onboarding) and Tab 3 (graph). Shared by server and pages.

import type { Claim, Person } from '$lib/claims';
import type { Verdict } from '$lib/review';
import type { ScanStats } from '$lib/scan';

export type Level = 'high' | 'medium' | 'low';
export type Resolution = 'resolved' | 'ambiguous' | 'unresolved';

export interface Factor {
	factor: string;
	points: number;
	detail: string;
}

export interface CriticalPart {
	id: string;
	name: string;
	path: string;
	start: number;
	end: number;
	score: number;
	level: Level;
	component: string | null;
	factors: Factor[];
	/** Cited evidence for why it's critical. */
	claims: Claim[];
	ask: Person | null;
}

export interface ComponentInfo {
	id: string;
	name: string;
	files: string[];
	criticality: number;
	level: Level;
	top: { id: string; name: string; level: Level }[];
}

/** A commit as the wiki shows it. */
export interface CommitRef {
	sha: string;
	subject: string;
	author: string;
	/** ISO date. */
	date: string;
}

/**
 * "What not to break" (docs/ui-spec.md §4.3): code that looks removable but whose line history or
 * comments say it guards against something, with the verdict a PR changing it would get.
 */
export interface Fence {
	id: string;
	/** Plain headline: what the commit behind it says, else the warning comment. */
	title: string;
	fn: { id: string; name: string; level: Level };
	path: string;
	/** The guarded lines (warning comment plus the code under it) at the snapshot. */
	start: number;
	end: number;
	/** Source around the guarded lines. */
	code: { start: number; lines: string[] };
	/** Rule floor of a PR that changes these lines (`review/rules.ts`): DANGEROUS or STOP. */
	verdict: Verdict;
	/** The rules behind the verdict, in plain words. */
	because: string[];
	/** The commit that says why, from the lines' full history (`git log -L`), not just blame. */
	origin:
		| (CommitRef & {
				/** Where its message states a workaround; null = a bug-fix or HW/timing commit. */
				stated: 'subject' | 'body' | null;
				/** What the message says: the subject, or the body sentence that states the workaround. */
				said: string;
		  })
		| null;
	/** Someone changed these lines before and it was reverted. */
	reverted: { change: CommitRef; revert: CommitRef; days: number; reason: string | null } | null;
	/** Warning comment on or just above the lines. */
	comment: { line: number; text: string } | null;
	/** Other functions whose lines came from the same commit (the same guard, copied). */
	alsoIn: { fn: string; path: string; line: number }[];
	/** Transitive dependents of the enclosing function (the blast radius meter's count). */
	dependents: { functions: number; files: number; outside: number; lowerBound: boolean };
	ask: Person | null;
}

/**
 * The model's reading of one fence, from its code, the function around it and the commit
 * messages that shaped it. Every claim is validated against that evidence (plan §4.5.5); the
 * verdict stays the rule floor.
 */
export interface FenceReading {
	/** What problem the guard protects against. */
	protects: Claim | null;
	/** What would likely go wrong without it. */
	ifRemoved: Claim | null;
	/** What to check or test before changing it. */
	beforeChanging: Claim | null;
	/** What the evidence can't answer: ask a human. */
	question: string | null;
	model: string;
	cached: boolean;
	/** Claims the validator downgraded (cited something it wasn't given, unquoted text, ...). */
	downgrades: number;
}

export interface FenceReport {
	fences: Fence[];
	/** Lines with workaround evidence that were considered. */
	candidates: number;
	ms: number;
}

/**
 * Code outside the deep scope that includes a header belonging to one module inside it (a driver's
 * registers or internals), not the scope's public header. Changing that header can break it.
 */
export interface Coupling {
	header: string;
	/** Source file the header belongs to. */
	owner: string;
	includers: { path: string; line: number }[];
}

/** A module on the other side of the scope's boundary (`libraries/AP_HAL`, `ArduCopter`). */
export interface ModuleLink {
	path: string;
	name: string;
	/** Distinct files on the other side of the link. */
	files: number;
	/** `#include` lines behind the link (a few, as evidence). */
	includes: { path: string; line: number; header: string }[];
	count: number;
}

/**
 * System at a glance (docs/ui-spec.md §4.3): who uses the scope, what it is made of, what it
 * depends on. Built from resolved `#include`s only, so every link is a cited code fact.
 */
export interface Architecture {
	/** The header most included from outside: the scope's public interface. */
	publicHeader: string | null;
	usedBy: ModuleLink[];
	dependsOn: ModuleLink[];
	/** Outside modules that include one component's internal header (hidden couplings). */
	reachIn: { module: string; header: string; component: string | null }[];
}

/**
 * One layer of the architecture picture. The model names and describes it; its members are
 * checked against what the scan found on that side (used-by modules, components, dependencies).
 */
export interface ArchLayer {
	/** Outside users, inside the scope, or what it is built on. */
	side: 'above' | 'inside' | 'below';
	title: string;
	/** One line: what this layer does. */
	role: string;
	/** Module or component names, as the scan named them. */
	members: string[];
}

/** The model's part of the wiki: intro, architecture layers, what each start file does. */
export interface WikiOverview {
	/** Two sentences, each a claim validated against the evidence. */
	claims: Claim[];
	/** Null when the model gave no usable layers: the page draws its deterministic ones. */
	layers: ArchLayer[] | null;
	/** Reading-order path → one line on what the file does. */
	files: Record<string, string>;
	model: string;
	cached: boolean;
	downgrades: number;
}

export interface OnboardingPack {
	repo: string;
	commit: string;
	deepScope: string;
	components: ComponentInfo[];
	critical: CriticalPart[];
	architecture: Architecture;
	couplings: Coupling[];
	assumptions: Claim[];
	interfaces: Claim[];
	unknowns: Claim[];
	coverage: { stats: ScanStats | null; notes: string[] };
	readingOrder: {
		path: string;
		why: string;
		/** The file's most critical functions: where to look first in it. */
		functions: string[];
	}[];
	/** Mermaid `graph LR` of components and their resolved dependencies. */
	mermaid: string;
}

export type GraphLevel = 'component' | 'file' | 'symbol';

export interface GraphNode {
	id: string;
	label: string;
	kind: 'component' | 'file' | 'function' | 'class' | 'macro' | 'boundary';
	path: string | null;
	component: string | null;
	level: Level;
	score: number;
	/** Signal kinds present (badges). */
	signals: string[];
	boundary: boolean;
	/** Relative size: fan-in / file count. */
	size: number;
}

export interface GraphEdge {
	from: string;
	to: string;
	kind: string;
	resolution: Resolution;
	weight: number;
}

export interface GraphData {
	level: GraphLevel;
	nodes: GraphNode[];
	edges: GraphEdge[];
	truncated: boolean;
}

export interface NodeDetails {
	node: GraphNode & { start?: number; end?: number; signature?: string };
	factors: Factor[];
	signals: {
		kind: string;
		source: string;
		path: string;
		line: number;
		snippet: string;
		detail: string;
	}[];
	commits: {
		sha: string;
		subject: string;
		author: string;
		date: string;
		bugfix: boolean;
		revert: boolean;
		rationale: boolean;
	}[];
	coChange: { path: string; count: number; strength: number }[];
	authors: { name: string; email: string; commits: number }[];
	edges: {
		incoming: Record<Resolution, number>;
		outgoing: Record<Resolution, number>;
		outside: number;
		externalCalls: number;
	};
	/** Plan §3 rule 3: whom to ask about this code. */
	ask: Person | null;
}

/**
 * How much of the analysed system transitively depends on a node (the blast radius meter).
 * Unlimited depth over dependency edges; co-change is never followed. The node itself is excluded.
 */
export interface Reach {
	/** Deep-scope files with code that depends on the node. The meter's headline share. */
	files: { affected: number; total: number };
	/** Functions and classes that depend on it. */
	symbols: { affected: number; total: number };
	/** Components with a dependent, other than the node's own. */
	components: { affected: number; total: number };
	/** `files.affected / files.total`, 0-1. */
	share: number;
	/** Longest dependency chain found (hops). */
	maxDepth: number;
	/** Dependents first reached at depth 1, 2, 3… (files and symbols). */
	byDepth: number[];
	/** Dependents outside the deep scope (found by the reference index). */
	outside: number;
	/** Ambiguous and unresolved edges reached: dependents the count may miss or over-count. */
	ambiguous: number;
	unresolved: number;
	/** Plan §3 rule 7: missing evidence never implies safety. True when the share is a lower bound. */
	lowerBound: boolean;
}

export interface Authorship {
	path: string;
	line: number;
	commit: string;
	lastModifiedBy: Person | null;
	/** Best effort: null = unknown (history too tangled to trace). */
	introducedBy: Person | null;
	introducedNote: string;
}
