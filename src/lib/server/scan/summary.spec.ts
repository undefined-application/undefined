import { describe, expect, it } from 'vitest';
import { filesOf, layersOf, sentencesOf } from './summary';

const pools = {
	above: ['ArduCopter', 'AP_AHRS'],
	inside: ['AP_InertialSensor', 'AP_InertialSensor_Invensense'],
	below: ['AP_HAL']
};

describe('layersOf', () => {
	it('keeps only names the scan found on that side, spelled as the scan spells them', () => {
		const layers = layersOf(
			[
				{
					side: 'above',
					title: 'Vehicles',
					role: 'Use the samples.',
					members: ['arducopter', 'AP_Nope']
				},
				{
					side: 'inside',
					title: 'Core',
					role: 'Filters.',
					members: ['AP_InertialSensor', 'AP_HAL']
				},
				{ side: 'below', title: 'Platform', role: 'Buses.', members: ['AP_HAL'] }
			],
			pools
		);
		expect(layers?.map((l) => [l.side, l.members])).toEqual([
			['above', ['ArduCopter']],
			['inside', ['AP_InertialSensor']],
			['below', ['AP_HAL']]
		]);
	});

	it('drops layers without members and returns null without an inside layer', () => {
		expect(
			layersOf([{ side: 'above', title: 'Vehicles', members: ['ArduCopter'] }], pools)
		).toBeNull();
		expect(
			layersOf(
				[
					{ side: 'inside', title: 'Ghosts', members: ['Nothing'] },
					{ side: 'inside', title: 'Drivers', members: ['AP_InertialSensor_Invensense'] }
				],
				pools
			)?.map((l) => l.title)
		).toEqual(['Drivers']);
	});
});

describe('filesOf', () => {
	it('describes reading-order files only, matched by path or file name', () => {
		expect(
			filesOf(
				[
					{ path: 'lib/a.cpp', what: 'Reads the FIFO.' },
					{ path: 'b.h', what: 'The interface.' },
					{ path: 'lib/other.cpp', what: 'Not asked for.' }
				],
				['lib/a.cpp', 'lib/b.h']
			)
		).toEqual({ 'lib/a.cpp': 'Reads the FIFO.', 'lib/b.h': 'The interface.' });
	});
});

describe('sentencesOf', () => {
	it('reads the requested shape', () => {
		const text = JSON.stringify({
			sentences: [
				{ text: 'It reads the IMUs.', status: 'inferred', cite: ['E1'] },
				{ text: 'AP_AHRS includes it.', status: 'verified', basis: 'code_fact', cite: ['E2'] }
			]
		});
		expect(sentencesOf(text)).toHaveLength(2);
	});

	it('reads claim objects the model split the answer into', () => {
		const text = `<think>…</think>
{"text": "It reads the IMUs.", "status": "inferred", "cite": ["E1"]},
{"text": "AP_AHRS includes it.", "status": "verified", "cite": ["E2"]}`;
		expect(sentencesOf(text).map((s) => (s as { text: string }).text)).toEqual([
			'It reads the IMUs.',
			'AP_AHRS includes it.'
		]);
	});

	it('returns nothing for prose', () => {
		expect(sentencesOf('I cannot answer that.')).toEqual([]);
	});
});
