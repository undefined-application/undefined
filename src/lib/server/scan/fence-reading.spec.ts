import { describe, expect, it } from 'vitest';
import { partsOf } from './fence-reading';

describe('partsOf', () => {
	it('reads the requested shape: one object with a claim per part', () => {
		const { claims, question } = partsOf(
			JSON.stringify({
				protects: { text: 'guards FIFO', status: 'verified', cite: ['E3'] },
				if_removed: { text: 'bad data', status: 'inferred', confidence: 'high', cite: ['E1'] },
				before_changing: { text: 'test on ICM20602', status: 'inferred', cite: ['E1'] },
				question: 'still needed?'
			})
		);
		expect(claims.protects).toMatchObject({ text: 'guards FIFO', status: 'verified' });
		expect(claims.if_removed).toMatchObject({ text: 'bad data', confidence: 'high' });
		expect(claims.before_changing).toMatchObject({ text: 'test on ICM20602' });
		expect(question).toBe('still needed?');
	});

	it('reads flat objects split over the response, as DeepSeek answered on the broker', () => {
		const text = [
			'{"protects": "guards FIFO", "status": "verified", "basis": "commit_statement", "cite": ["E3"]},',
			'{"if_removed": "bad data", "status": "inferred", "confidence": "high", "cite": ["E3", "E5"]},',
			'{"before_changing": "test on ICM20602", "status": "inferred", "cite": ["E4"]},',
			'{"question": "still needed?"}'
		].join('\n');
		const { claims, question } = partsOf(`<think>plan</think>\n${text}`);
		expect(claims.protects).toMatchObject({ text: 'guards FIFO', basis: 'commit_statement' });
		expect(claims.if_removed).toMatchObject({ text: 'bad data', cite: ['E3', 'E5'] });
		expect(claims.before_changing).toMatchObject({ text: 'test on ICM20602', cite: ['E4'] });
		expect(question).toBe('still needed?');
	});

	it('returns nothing for a response without parts', () => {
		expect(partsOf('Sorry, I cannot help.').claims).toEqual({});
	});
});
