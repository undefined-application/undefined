// Plan §4.5.5 claim validation. Runs after every LLM call, before anything is stored or shown.
// The model cites evidence by item id only; anything it didn't get, it can't cite.

import {
	STATUS_RANK,
	type Citation,
	type Claim,
	type ClaimBasis,
	type ClaimStatus,
	type Confidence
} from '$lib/claims';

/** One item of the evidence packet sent to the model, with a stable id (`E1`, `E2`, …). */
export interface EvidenceItem {
	id: string;
	citation: Citation;
	/** What the model was shown for this item: code lines, commit message, signal, child claim. */
	text: string;
	/** Set when the item is itself a claim (child summary): caps the parent's certainty. */
	status?: ClaimStatus;
}

/** Claim as the model returns it (untrusted). */
export interface RawClaim {
	text?: unknown;
	status?: unknown;
	confidence?: unknown;
	basis?: unknown;
	cite?: unknown;
	quote?: unknown;
}

export interface Downgrade {
	text: string;
	from: ClaimStatus;
	to: ClaimStatus;
	reason: string;
}

const STATUSES: ClaimStatus[] = ['verified', 'inferred', 'unknown'];
const BASES: ClaimBasis[] = ['code_fact', 'commit_statement', 'comment_statement', 'inference'];
const CONFIDENCES: Confidence[] = ['low', 'medium', 'high'];

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A quote may elide with "..." / "…"; then every piece must appear in the item, in order. */
function quotes(text: string, quote: string): boolean {
	const pieces = quote.split(/\s*(?:\.\.\.|…)\s*/).filter(Boolean);
	let at = 0;
	for (const piece of pieces) {
		const found = text.indexOf(piece, at);
		if (found < 0) return false;
		at = found + piece.length;
	}
	return pieces.length > 0;
}

export function validateClaims(
	raw: unknown,
	packet: EvidenceItem[]
): { claims: Claim[]; downgrades: Downgrade[] } {
	const byId = new Map(packet.map((e) => [e.id, e]));
	const claims: Claim[] = [];
	const downgrades: Downgrade[] = [];
	if (!Array.isArray(raw)) return { claims, downgrades };

	for (const r of raw as RawClaim[]) {
		if (!r || typeof r.text !== 'string' || !r.text.trim()) continue;
		const text = r.text.trim();
		const claimed: ClaimStatus = STATUSES.includes(r.status as ClaimStatus)
			? (r.status as ClaimStatus)
			: 'unknown';
		const basis: ClaimBasis = BASES.includes(r.basis as ClaimBasis)
			? (r.basis as ClaimBasis)
			: 'inference';
		const confidence = CONFIDENCES.includes(r.confidence as Confidence)
			? (r.confidence as Confidence)
			: undefined;
		const ids = Array.isArray(r.cite)
			? r.cite.filter((x): x is string => typeof x === 'string')
			: [];
		const quote = typeof r.quote === 'string' && r.quote.trim() ? squash(r.quote) : null;

		let status = claimed;
		const reasons: string[] = [];
		const lower = (to: ClaimStatus, reason: string) => {
			if (STATUS_RANK[to] < STATUS_RANK[status]) {
				reasons.push(reason);
				status = to;
			}
		};

		// Only evidence that was in the packet counts, and a quote must appear in what it cites.
		const valid: EvidenceItem[] = [];
		for (const id of ids) {
			const item = byId.get(id);
			if (!item) {
				reasons.push(`cites ${id}, which was not in its evidence`);
				continue;
			}
			valid.push(item);
		}
		if (quote && !valid.some((v) => quotes(squash(v.text), quote))) {
			lower(
				status === 'verified' ? 'inferred' : status,
				'quoted text is not in the cited evidence'
			);
			valid.length = 0;
		}

		if (status === 'verified') {
			if (basis === 'inference') lower('inferred', 'basis is inference');
			else if (valid.length === 0) lower('inferred', 'no valid citation');
			else if (basis === 'commit_statement' && !valid.some((v) => v.citation.kind === 'commit'))
				lower('inferred', 'commit_statement without a commit citation');
			else if (basis !== 'commit_statement' && !valid.some((v) => v.citation.kind === 'code'))
				lower('inferred', `${basis} without a code citation`);
		}
		if (status === 'inferred' && valid.length === 0)
			lower('unknown', 'inferred without a valid citation');

		// A claim built only on child claims can't be more certain than the most certain child.
		if (valid.length > 0 && valid.every((v) => v.status)) {
			const cap = valid.reduce<ClaimStatus>(
				(best, v) => (STATUS_RANK[v.status!] > STATUS_RANK[best] ? v.status! : best),
				'unknown'
			);
			lower(cap, 'cannot be more certain than the claims it is built on');
		}

		if (status !== claimed)
			downgrades.push({ text, from: claimed, to: status, reason: reasons.join('; ') });
		claims.push({
			text,
			status,
			confidence: status === 'inferred' ? (confidence ?? 'low') : undefined,
			basis: status === 'verified' ? basis : status === 'inferred' ? 'inference' : basis,
			citations: [...new Map(valid.map((v) => [JSON.stringify(v.citation), v.citation])).values()]
		});
	}
	return { claims, downgrades };
}
