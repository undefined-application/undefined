import { beforeAll, describe, expect, it } from 'vitest';
import { blank, parseC } from './cparse';
import { detectSignals, scoreSymbols } from './signals';
import { buildStructure, resolveInclude, type EdgeRow, type Structure } from './structure';

describe('blank', () => {
	it('keeps offsets, drops comments and literals, collects comments', () => {
		const src =
			'int a = 1; // note: do not remove\nconst char *s = "x { y";\n/* multi\n * errata */\n';
		const b = blank(src);
		expect(b.code.length).toBe(src.length);
		expect(b.code).not.toContain('{');
		expect(b.comments.map((c) => [c.line, c.text])).toEqual([
			[1, 'note: do not remove'],
			[3, 'multi'],
			[4, 'errata']
		]);
	});

	it('keeps the first #if branch and blanks #else, so braces stay balanced', () => {
		const src = [
			'#if BOARD_A',
			'void f(int x) {',
			'#else',
			'void f(void) {',
			'#endif',
			'  g();',
			'}'
		].join('\n');
		const p = parseC(src);
		expect(p.unbalanced).toBe(false);
		expect(
			p.symbols.filter((s) => s.kind === 'function').map((s) => [s.name, s.start, s.end])
		).toEqual([['f', 2, 7]]);
	});
});

describe('parseC', () => {
	const src = `#include "imu.h"
#include <stdint.h>
#define IMU_TIMEOUT_MS 10

class Imu {
public:
    bool read() { return _check(1); }
private:
    bool _check(int t);
};

bool Imu::_check(int t)
{
    return t > 0;
}

static void helper(void) {
    int n = 0;
}
`;
	const p = parseC(src);

	it('finds functions with qualified names and line ranges', () => {
		const fns = p.symbols.filter((s) => s.kind === 'function').map((s) => [s.name, s.start, s.end]);
		expect(fns).toEqual([
			['Imu::read', 7, 7],
			['Imu::_check', 12, 15],
			['helper', 17, 19]
		]);
	});

	it('finds classes, macros and includes', () => {
		expect(p.symbols.find((s) => s.kind === 'class')).toMatchObject({
			name: 'Imu',
			start: 5,
			end: 10
		});
		expect(p.symbols.find((s) => s.kind === 'macro')?.name).toBe('IMU_TIMEOUT_MS');
		expect(p.includes).toEqual([
			{ line: 1, path: 'imu.h', system: false },
			{ line: 2, path: 'stdint.h', system: true }
		]);
	});
});

describe('edge resolution', () => {
	const a = `
class Imu { void poll(); void _reset(); };
void Imu::_reset() {}
void Imu::poll() {
    _reset();              // own class method: resolved
    update();              // defined in two classes: ambiguous
    dev->transfer(0);      // not in scope: external
    (*callback)(3);        // function pointer: unresolved
    vtable[2](4);          // table call: unresolved
}
`;
	const b = `
class Baro { void update(); };
void Baro::update() {}
class Mag { void update(); };
void Mag::update() {}
`;
	let s: Structure;
	let calls: EdgeRow[];
	beforeAll(async () => {
		s = await buildStructure({
			deep: [
				{ path: 'lib/imu.cpp', text: a },
				{ path: 'lib/baro.cpp', text: b }
			],
			reference: [
				{ path: 'app/main.cpp', text: '#include "lib/imu.h"\nvoid main() { Imu::poll(); }' }
			],
			allPaths: ['lib/imu.cpp', 'lib/imu.h', 'lib/baro.cpp', 'app/main.cpp']
		});
		calls = s.edges.filter((e) => e.kind === 'calls' && e.from.endsWith('#Imu::poll'));
	});

	it('resolves a unique call in the caller class', () => {
		expect(calls.find((e) => e.to.endsWith('#Imu::_reset'))?.resolution).toBe('resolved');
	});

	it('marks a same-named method in several classes ambiguous, with candidates', () => {
		const e = calls.find((x) => x.resolution === 'ambiguous')!;
		expect(e.candidates?.sort()).toEqual([
			'sym:lib/baro.cpp#Baro::update',
			'sym:lib/baro.cpp#Mag::update'
		]);
	});

	it('marks function-pointer and table calls unresolved open ends', () => {
		expect(calls.filter((e) => e.resolution === 'unresolved').map((e) => e.evidence.line)).toEqual([
			8, 9
		]);
	});

	it('counts calls to names outside the deep scope instead of inventing edges', () => {
		expect(s.symbols.find((x) => x.name === 'Imu::poll')?.externalCalls).toBe(1);
	});

	it('indexes references from outside the deep scope as boundary edges', () => {
		expect(s.boundary).toEqual(['app/main.cpp']);
		const ref = s.edges.filter((e) => e.method === 'reference_index');
		expect(ref.some((e) => e.kind === 'includes' && e.to === 'file:lib/imu.h')).toBe(false); // imu.h isn't deep
		expect(ref.some((e) => e.to === 'sym:lib/imu.cpp#Imu')).toBe(true);
	});
});

describe('resolveInclude', () => {
	const all = ['libraries/AP_HAL/AP_HAL.h', 'libraries/A/x.h', 'libraries/B/x.h', 'drv/imu.h'];
	const bySuffix = new Map<string, string[]>();
	for (const p of all) {
		const base = p.slice(p.lastIndexOf('/') + 1);
		bySuffix.set(base, [...(bySuffix.get(base) ?? []), p]);
	}
	const set = new Set(all);
	it.each([
		['drv/imu.cpp', 'imu.h', 'resolved', ['drv/imu.h']],
		['x/y.cpp', 'AP_HAL/AP_HAL.h', 'resolved', ['libraries/AP_HAL/AP_HAL.h']],
		['x/y.cpp', 'x.h', 'ambiguous', ['libraries/A/x.h', 'libraries/B/x.h']],
		['x/y.cpp', 'hwdef.h', 'unresolved', []]
	])('%s includes %s → %s', (from, inc, resolution, targets) => {
		expect(resolveInclude(from, inc, set, bySuffix)).toEqual({ resolution, targets });
	});
});

describe('signals', () => {
	const src = `
void EXTI0_IRQHandler(void) {
    volatile uint32_t *reg = (volatile uint32_t *)0x40013C00;
    *reg = 1;
}
void sensor_init(void) {
    // errata 2.1: the chip needs 10 ms after reset, see datasheet
    hal.scheduler->delay(10);
    for (uint8_t tries = 0; tries < 3; tries++) {
        if (register_read(WHOAMI) == 0x68) break;
    }
}
`;
	const p = parseC(src);
	const signals = detectSignals('drv.c', src, p);
	const kinds = (line: number) => signals.filter((s) => s.start === line).map((s) => s.kind);

	it('detects ISR, volatile MMIO, delay, errata comment and retry loop', () => {
		expect(kinds(2)).toContain('isr');
		expect(kinds(3)).toContain('hw_access');
		expect(kinds(7)).toContain('workaround_comment');
		expect(kinds(8)).toContain('timing');
		expect(kinds(9)).toContain('defensive');
		expect(kinds(10)).toContain('hw_register');
	});

	it('scores functions from the signals inside them, with an explanation', async () => {
		const s = await buildStructure({
			deep: [{ path: 'drv.c', text: src }],
			reference: [],
			allPaths: ['drv.c']
		});
		const scores = scoreSymbols(s.symbols, signals, s.edges);
		const init = scores.get('sym:drv.c#sensor_init')!;
		expect(init.score).toBeGreaterThan(0);
		expect(init.factors.map((f) => f.factor)).toEqual(
			expect.arrayContaining(['workaround_comment', 'timing', 'defensive', 'hw_register'])
		);
	});
});
