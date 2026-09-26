import { createHash } from 'node:crypto';
import type { ReferenceScope } from '$lib/scan';

/** Bump when parsing/extraction output changes, so old snapshots aren't reused. */
export const PARSER_VERSION = 'stage4-2';

/** Analysis knobs that change results. Part of snapshot identity (plan §4.5.3). */
export const ANALYSIS_CONFIG = {
	cloneFilter: 'blob:none',
	/** `git blame -w`: whitespace-only reformat commits don't hide who wrote a line. */
	blameIgnoreWhitespace: true,
	/** Commits touching more deep-scope files than this are sweeps, not coupling evidence. */
	coChangeMaxFiles: 25,
	coChangeMinCount: 3
} as const;

export interface SnapshotIdentity {
	repo: string;
	commitSha: string;
	deepScope: string;
	referenceScope: ReferenceScope;
	configHash: string;
	parserVersion: string;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const configHash = (config: object = ANALYSIS_CONFIG) => sha256(JSON.stringify(config));

/** Deterministic: fixed key order, so equal identities always hash equal. */
export function snapshotId(id: SnapshotIdentity): string {
	const { repo, commitSha, deepScope, referenceScope, configHash, parserVersion } = id;
	return sha256(
		JSON.stringify([repo, commitSha, deepScope, referenceScope, configHash, parserVersion])
	).slice(0, 32);
}

/** `/a/b/` → `a/b`. Empty string = whole repo. Rejects `..` escapes. */
export function normalizeScope(path: string | undefined | null): string {
	const parts = (path ?? '').split('/').filter((p) => p && p !== '.');
	if (parts.includes('..')) throw new Error('Subpath must not contain ".."');
	return parts.join('/');
}
