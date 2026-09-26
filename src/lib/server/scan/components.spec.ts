import { describe, expect, it } from 'vitest';
import { buildComponents } from './components';
import type { EdgeRow } from './structure';

const call = (a: string, b: string): EdgeRow => ({
	from: `sym:${a}#f`,
	to: `sym:${b}#g`,
	kind: 'calls',
	method: 'name_match',
	resolution: 'resolved',
	weight: 1,
	evidence: { path: a, line: 1 }
});

describe('buildComponents', () => {
	it('returns no components (and terminates) for a scope without source files', async () => {
		expect(await buildComponents('', [], [])).toEqual([]);
	});

	it('groups a small scope by directory', async () => {
		const files = ['drv/imu/a.c', 'drv/imu/b.c', 'drv/baro/c.c'];
		const comps = await buildComponents('drv', files, []);
		expect(comps.map((c) => c.files)).toEqual([['drv/imu/a.c', 'drv/imu/b.c'], ['drv/baro/c.c']]);
	});

	it('splits a large directory along its dependency clusters and names them', async () => {
		// Two clusters of files that only call within themselves, plus unrelated singles to pass 30 files.
		const imu = Array.from({ length: 6 }, (_, i) => `lib/Sensor_Imu${i}.cpp`);
		const baro = Array.from({ length: 6 }, (_, i) => `lib/Sensor_Baro${i}.cpp`);
		const rest = Array.from({ length: 20 }, (_, i) => `lib/Sensor_Misc${i}.cpp`);
		const edges = [
			...imu.flatMap((a) => imu.filter((b) => b !== a).map((b) => call(a, b))),
			...baro.flatMap((a) => baro.filter((b) => b !== a).map((b) => call(a, b)))
		];
		const comps = await buildComponents('lib', [...imu, ...baro, ...rest], edges);
		const imuComp = comps.find((c) => c.files.includes(imu[0]))!;
		expect(imuComp.files.sort()).toEqual([...imu].sort());
		expect(comps.find((c) => c.files.includes(baro[0]))!.files.sort()).toEqual([...baro].sort());
		// Every file shares `Sensor`, so names use the hub file instead of that prefix.
		expect(imuComp.name).toMatch(/^Sensor_Imu\d \+5$/);
	});
});
