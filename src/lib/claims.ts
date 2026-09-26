// Plan §3 rule 1 + §4.4 `Claim`: the atom every statement the tool makes is built from.
// Shared by server (validator, reviewer, docs) and pages (badges, citations).

export type ClaimStatus = 'verified' | 'inferred' | 'unknown';
export type Confidence = 'low' | 'medium' | 'high';
/** Where a claim's certainty comes from. Only the first three can back a Verified claim. */
export type ClaimBasis = 'code_fact' | 'commit_statement' | 'comment_statement' | 'inference';

/** Every citation names the commit (snapshot) it refers to (plan §3 rule 2). */
export type Citation =
	| { kind: 'code'; commit: string; path: string; start: number; end: number }
	| { kind: 'commit'; sha: string; subject?: string };

export interface Claim {
	text: string;
	status: ClaimStatus;
	confidence?: Confidence;
	basis: ClaimBasis;
	citations: Citation[];
	/** For Unknown claims: who could answer (plan §3 rule 3). */
	ask?: Person;
}

export interface Person {
	name: string;
	email: string;
	/** Commit that ties this person to the code. */
	sha: string;
	date: string;
	subject: string;
	login?: string | null;
}

export const STATUS_RANK: Record<ClaimStatus, number> = { unknown: 0, inferred: 1, verified: 2 };

export const permalink = (repo: string, c: Citation) =>
	c.kind === 'code'
		? `https://github.com/${repo}/blob/${c.commit}/${c.path}#L${c.start}${c.end > c.start ? `-L${c.end}` : ''}`
		: `https://github.com/${repo}/commit/${c.sha}`;

export const citationLabel = (c: Citation) =>
	c.kind === 'code'
		? `${c.path.split('/').pop()}:${c.start}${c.end > c.start ? `–${c.end}` : ''} @${c.commit.slice(0, 7)}`
		: c.sha.slice(0, 10);
