import { describe, expect, it } from 'vitest';
import { validateClaims, type EvidenceItem } from './validate';

const packet: EvidenceItem[] = [
	{
		id: 'E1',
		citation: { kind: 'code', commit: 'c0ffee', path: 'drv.cpp', start: 10, end: 12 },
		text: 'if (!_check_raw_temp(t2)) {\n    _fifo_reset();\n}'
	},
	{
		id: 'E2',
		citation: { kind: 'commit', sha: 'd2f6a514b9' },
		text: 'catch FIFO alignment errors using temperature reading'
	},
	{ id: 'E3', citation: { kind: 'commit', sha: 'aaaa' }, text: 'child summary', status: 'inferred' }
];

const one = (claim: object) => validateClaims([claim], packet);

describe('validateClaims', () => {
	it('keeps a verified code fact with a valid citation and quote', () => {
		const { claims, downgrades } = one({
			text: 'The driver resets the FIFO when the temperature check fails.',
			status: 'verified',
			basis: 'code_fact',
			cite: ['E1'],
			quote: '_fifo_reset();'
		});
		expect(claims[0]).toMatchObject({ status: 'verified', basis: 'code_fact' });
		expect(claims[0].citations).toEqual([packet[0].citation]);
		expect(downgrades).toEqual([]);
	});

	it('downgrades a verified claim whose citation was not in the evidence packet', () => {
		const { claims, downgrades } = one({
			text: 'x',
			status: 'verified',
			basis: 'code_fact',
			cite: ['E9']
		});
		expect(claims[0].status).toBe('unknown');
		expect(downgrades[0].reason).toContain('E9');
	});

	it('downgrades a real-but-unrelated citation whose quote does not match', () => {
		const { claims } = one({
			text: 'The driver sleeps 10 ms.',
			status: 'verified',
			basis: 'code_fact',
			cite: ['E1'],
			quote: 'hal.scheduler->delay(10);'
		});
		expect(claims[0].status).not.toBe('verified');
		expect(claims[0].citations).toEqual([]);
	});

	it('accepts a quote elided with "..." when every piece is in the item, in order', () => {
		const quote = (q: string) =>
			one({ text: 'x', status: 'verified', basis: 'code_fact', cite: ['E1'], quote: q }).claims[0];
		expect(quote('if (!_check_raw_temp(t2)) { ... _fifo_reset();').status).toBe('verified');
		expect(quote('if (!_check_raw_temp(t2)) {…_fifo_reset();').status).toBe('verified');
		expect(quote('_fifo_reset(); ... if (!_check_raw_temp(t2))').status).not.toBe('verified');
		expect(quote('_check_raw_temp(t2) ... delay(10)').status).not.toBe('verified');
		expect(quote('...').status).not.toBe('verified');
	});

	it('downgrades basis: inference marked verified to inferred', () => {
		const { claims } = one({
			text: 'The check guards against a HW bug.',
			status: 'verified',
			basis: 'inference',
			cite: ['E2']
		});
		expect(claims[0]).toMatchObject({ status: 'inferred', basis: 'inference', confidence: 'low' });
	});

	it('requires a commit citation for commit_statement', () => {
		const { claims } = one({
			text: 'y',
			status: 'verified',
			basis: 'commit_statement',
			cite: ['E1']
		});
		expect(claims[0].status).toBe('inferred');
	});

	it('turns an inferred claim with no citation into unknown', () => {
		const { claims } = one({
			text: 'The chip has a silicon bug.',
			status: 'inferred',
			confidence: 'high',
			cite: []
		});
		expect(claims[0].status).toBe('unknown');
	});

	it('does not let a parent be more certain than its child claims', () => {
		const { claims } = one({
			text: 'Component does Z.',
			status: 'verified',
			basis: 'commit_statement',
			cite: ['E3']
		});
		expect(claims[0].status).toBe('inferred');
	});

	it('ignores malformed claims', () => {
		expect(validateClaims([{ status: 'verified' }, null, 'x'], packet).claims).toEqual([]);
		expect(validateClaims('nope', packet).claims).toEqual([]);
	});
});
