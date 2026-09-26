import { describe, expect, it } from 'vitest';
import { classifyChange, parseUnifiedDiff } from './diff';
import { ruleFloor, type RuleInput } from './rules';

describe('parseUnifiedDiff', () => {
	it('reads files, hunks and line numbers from -U0 output', () => {
		const out = [
			'diff --git a/drv.cpp b/drv.cpp',
			'index 1..2 100644',
			'--- a/drv.cpp',
			'+++ b/drv.cpp',
			'@@ -549 +549 @@ bool X::_accumulate()',
			'-        if (!_check_raw_temp(t2)) {',
			'+        if (!_disable && !_check_raw_temp(t2)) {',
			'@@ -228,0 +229 @@',
			'+        _disable = true;',
			'diff --git a/new.h b/new.h',
			'new file mode 100644',
			'--- /dev/null',
			'+++ b/new.h',
			'@@ -0,0 +1,2 @@',
			'+#pragma once',
			'+int x;'
		].join('\n');
		const files = parseUnifiedDiff(out);
		expect(files).toHaveLength(2);
		expect(files[0].hunks).toEqual([
			{
				oldStart: 549,
				oldLines: 1,
				newStart: 549,
				newLines: 1,
				removed: ['        if (!_check_raw_temp(t2)) {'],
				added: ['        if (!_disable && !_check_raw_temp(t2)) {']
			},
			{
				oldStart: 228,
				oldLines: 0,
				newStart: 229,
				newLines: 1,
				removed: [],
				added: ['        _disable = true;']
			}
		]);
		expect(files[1]).toMatchObject({ oldPath: null, newPath: 'new.h' });
	});
});

describe('classifyChange', () => {
	const base = `// read the sensor\nint f(int t) {\n    debug("temp %d", t);\n    return check(t, "id");\n}\n`;

	it('comment and whitespace edits are behaviour-free', () => {
		const next = base
			.replace('// read the sensor', '// Read the sensor (fixed typo)')
			.replace('return check', 'return  check');
		expect(classifyChange('drv.cpp', base, next)).toBe('comment_whitespace');
	});

	it('log message edits are log_string', () => {
		expect(classifyChange('drv.cpp', base, base.replace('"temp %d"', '"temperature %d"'))).toBe(
			'log_string'
		);
	});

	it('a changed non-log string literal is code', () => {
		expect(classifyChange('drv.cpp', base, base.replace('"id"', '"ID"'))).toBe('code');
	});

	it('a changed condition is code, and so is a changed #define', () => {
		expect(classifyChange('drv.cpp', base, base.replace('check(t,', 'check(!t,'))).toBe('code');
		expect(classifyChange('a.h', '#define N 3\n', '#define N 4\n')).toBe('code');
	});

	it('docs are docs; new or deleted sources are code', () => {
		expect(classifyChange('README.md', 'a', 'b')).toBe('docs');
		expect(classifyChange('drv.cpp', null, base)).toBe('code');
	});
});

describe('ruleFloor', () => {
	const input: RuleInput = {
		behaviourFree: false,
		history: [],
		workaroundComments: [],
		signals: [],
		touched: [],
		completeness: 'complete',
		relatedTests: 1
	};
	const hist = (over: object) => ({
		where: 'drv.cpp:549',
		sha: 'd2f6a514b98b',
		subject: 'catch FIFO alignment errors using temperature reading',
		revert: false,
		bugfix: false,
		rationale: true,
		explicit: true,
		...over
	});

	it('SAFE for behaviour-free changes regardless of completeness', () => {
		expect(ruleFloor({ ...input, behaviourFree: true, completeness: 'insufficient' }).floor).toBe(
			'SAFE'
		);
	});

	it('STOP when a changed line was shaped by an explicit workaround commit', () => {
		const r = ruleFloor({ ...input, history: [hist({})] });
		expect(r.floor).toBe('STOP');
		expect(r.reasons[0].rule).toBe('explicit_workaround');
	});

	it('STOP when the line was reverted before', () => {
		expect(ruleFloor({ ...input, history: [hist({ explicit: false, revert: true })] }).floor).toBe(
			'STOP'
		);
	});

	it('DANGEROUS for bug-fix history or a timing signal', () => {
		expect(ruleFloor({ ...input, history: [hist({ explicit: false, bugfix: true })] }).floor).toBe(
			'DANGEROUS'
		);
		expect(ruleFloor({ ...input, signals: [{ where: 'drv.cpp:12', kind: 'timing' }] }).floor).toBe(
			'DANGEROUS'
		);
	});

	it('RISKY for incomplete analysis or no related tests; SAFE only when nothing fires', () => {
		const touched = [{ name: 'f', level: 'low' as const }];
		expect(ruleFloor({ ...input, touched, completeness: 'partial' }).floor).toBe('RISKY');
		expect(ruleFloor({ ...input, relatedTests: 0 }).floor).toBe('RISKY');
		expect(ruleFloor({ ...input, touched }).floor).toBe('SAFE');
	});
});
