import { describe, expect, it } from 'vitest';
import { reachOf, type SnapshotView } from './views';

const sym = (path: string, name: string) => ({
	id: `sym:${path}#${name}`,
	path,
	name,
	kind: 'function'
});
const edge = (from: string, to: string, extra: Record<string, string> = {}) => ({
	from,
	to,
	kind: 'calls',
	method: 'name_match',
	resolution: 'resolved',
	...extra
});

/** fa <- fb <- fc (resolved), fa <- fd (ambiguous), fa <- lib/x.c (outside), a ~ d co-change. */
const model = {
	files: ['drv/a.c', 'drv/b.c', 'drv/c.c', 'drv/d.c'].map((path) => ({ path })),
	symbols: [sym('drv/a.c', 'fa'), sym('drv/b.c', 'fb'), sym('drv/c.c', 'fc'), sym('drv/d.c', 'fd')],
	components: [
		{ id: 'comp:A', files: ['drv/a.c'] },
		{ id: 'comp:B', files: ['drv/b.c', 'drv/c.c'] },
		{ id: 'comp:D', files: ['drv/d.c'] }
	],
	edges: [
		edge('sym:drv/b.c#fb', 'sym:drv/a.c#fa'),
		edge('sym:drv/c.c#fc', 'sym:drv/b.c#fb'),
		edge('sym:drv/d.c#fd', 'sym:drv/a.c#fa', { resolution: 'ambiguous' }),
		edge('file:lib/x.c', 'sym:drv/a.c#fa', { kind: 'references', method: 'reference_index' }),
		edge('file:drv/d.c', 'file:drv/a.c', { kind: 'co_changes', method: 'git_cochange' })
	]
} as unknown as SnapshotView;

describe('reachOf', () => {
	it('counts transitive dependents in the deep scope, and what it cannot see', () => {
		const r = reachOf(model, 'sym:drv/a.c#fa');
		expect(r.files).toEqual({ affected: 3, total: 3 });
		expect(r.share).toBe(1);
		expect(r.symbols).toEqual({ affected: 3, total: 4 });
		expect(r.components).toEqual({ affected: 2, total: 2 });
		expect(r.byDepth).toEqual([2, 1]);
		expect(r.maxDepth).toBe(2);
		expect(r.outside).toBe(1);
		expect(r.ambiguous).toBe(1);
		// Something outside the scope uses it: the share is a lower bound (plan §3 rule 7).
		expect(r.lowerBound).toBe(true);
	});

	it('never follows co-change, and a leaf has nothing depending on it', () => {
		const r = reachOf(model, 'file:drv/c.c');
		expect(r.files.affected).toBe(0);
		expect(r.share).toBe(0);
		expect(r.lowerBound).toBe(false);
		// drv/d.c only co-changes with drv/a.c: not a dependent of it.
		expect(reachOf(model, 'file:drv/a.c').files.affected).toBe(3);
	});
});
