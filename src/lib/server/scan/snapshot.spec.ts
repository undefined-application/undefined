import { describe, expect, it } from 'vitest';
import { configHash, normalizeScope, snapshotId, type SnapshotIdentity } from './snapshot';

const base: SnapshotIdentity = {
	repo: 'ArduPilot/ardupilot',
	commitSha: 'a'.repeat(40),
	deepScope: 'libraries/AP_InertialSensor',
	referenceScope: 'repo',
	configHash: configHash({ cloneFilter: 'blob:none' }),
	parserVersion: 'p1'
};

describe('snapshotId', () => {
	it('is stable for equal identities', () => {
		expect(snapshotId({ ...base })).toBe(snapshotId(base));
	});

	it.each([
		['commit', { commitSha: 'b'.repeat(40) }],
		['deep scope', { deepScope: 'libraries/AP_Baro' }],
		['reference scope', { referenceScope: 'subpath' as const }],
		['config', { configHash: configHash({ cloneFilter: 'none' }) }],
		['parser version', { parserVersion: 'p2' }]
	])('changes when the %s changes', (_, change) => {
		expect(snapshotId({ ...base, ...change })).not.toBe(snapshotId(base));
	});
});

describe('normalizeScope', () => {
	it('trims slashes and dots', () => {
		expect(normalizeScope('/libraries/./AP_Baro/')).toBe('libraries/AP_Baro');
		expect(normalizeScope('')).toBe('');
		expect(normalizeScope(undefined)).toBe('');
	});

	it('rejects parent-directory escapes', () => {
		expect(() => normalizeScope('libraries/../..')).toThrow();
	});
});
