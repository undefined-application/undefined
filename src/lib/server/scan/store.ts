// Persist a SnapshotModel. Writes go in small chunks with yields in between, so the server keeps
// answering while tens of thousands of rows land. That is safe because readers only load a
// snapshot through a *finished* scan run, the run is marked done after this returns, and a
// snapshot with a finished run is reused instead of re-analysed (see `runScan`).

import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	blameRange,
	codeSignal,
	codeSymbol,
	component,
	edge,
	fileHistory,
	fileModel,
	gitAuthor,
	gitCommit
} from '$lib/server/db/schema';
import { yielder } from '$lib/server/jobs/yield';
import type { SnapshotModel } from './pipeline';

const CHUNK = 400;

export async function storeModel(snapId: string, model: SnapshotModel) {
	const { structure, history, signals, symbolScores, fileScores, components } = model;
	const tick = yielder();
	const insertAll = async <T>(rows: T[], insert: (chunk: T[]) => void) => {
		for (let i = 0; i < rows.length; i += CHUNK) {
			insert(rows.slice(i, i + CHUNK));
			await tick();
		}
	};

	const componentOf = new Map<string, string>();
	for (const c of components) for (const f of c.files) componentOf.set(f, c.id);

	// Signal → innermost enclosing function, for per-symbol lookups.
	const fnsByPath = new Map<string, typeof structure.symbols>();
	for (const s of structure.symbols) {
		if (s.kind !== 'function') continue;
		const list = fnsByPath.get(s.path) ?? [];
		list.push(s);
		fnsByPath.set(s.path, list);
	}
	const enclosing = (path: string, line: number) =>
		(fnsByPath.get(path) ?? [])
			.filter((f) => f.start <= line && line <= f.end)
			.sort((a, b) => a.end - a.start - (b.end - b.start))[0]?.id ?? null;

	// Leftovers of an earlier run of this snapshot that never finished.
	db.transaction((tx) => {
		for (const table of [
			gitCommit,
			fileHistory,
			blameRange,
			gitAuthor,
			edge,
			codeSymbol,
			codeSignal,
			component,
			fileModel
		]) {
			tx.delete(table).where(eq(table.snapshotId, snapId)).run();
		}
	});

	await insertAll(structure.files, (chunk) =>
		db
			.insert(fileModel)
			.values(
				chunk.map((f) => {
					const c = fileScores.get(f.path);
					return {
						snapshotId: snapId,
						path: f.path,
						lines: f.lines,
						parsed: f.parsed,
						unbalanced: f.unbalanced,
						parseError: f.error,
						component: componentOf.get(f.path) ?? null,
						criticality: c?.score ?? 0,
						level: c?.level ?? 'low',
						factors: c?.factors ?? []
					};
				})
			)
			.run()
	);
	await insertAll(structure.symbols, (chunk) =>
		db
			.insert(codeSymbol)
			.values(
				chunk.map((s) => {
					const c = symbolScores.get(s.id);
					return {
						snapshotId: snapId,
						id: s.id,
						path: s.path,
						name: s.name,
						shortName: s.shortName,
						kind: s.kind,
						start: s.start,
						end: s.end,
						signature: s.signature.slice(0, 500),
						className: s.className,
						component: componentOf.get(s.path) ?? null,
						externalCalls: s.externalCalls,
						criticality: c?.score ?? 0,
						level: c?.level ?? 'low',
						factors: c?.factors ?? []
					};
				})
			)
			.run()
	);
	await insertAll(signals, (chunk) =>
		db
			.insert(codeSignal)
			.values(
				chunk.map((s) => ({ snapshotId: snapId, ...s, symbolId: enclosing(s.path, s.start) }))
			)
			.run()
	);
	await insertAll(components, (chunk) =>
		db
			.insert(component)
			.values(
				chunk.map((c) => ({
					snapshotId: snapId,
					id: c.id,
					name: c.name,
					files: c.files,
					criticality: c.criticality,
					level: c.level
				}))
			)
			.run()
	);
	await insertAll(structure.edges, (chunk) =>
		db
			.insert(edge)
			.values(chunk.map((e) => ({ snapshotId: snapId, ...e })))
			.run()
	);

	if (!history) return;
	await insertAll(history.commits, (chunk) =>
		db
			.insert(gitCommit)
			.values(chunk.map((c) => ({ snapshotId: snapId, ...c, authoredAt: new Date(c.authoredAt) })))
			.run()
	);
	await insertAll(history.files, (chunk) =>
		db
			.insert(fileHistory)
			.values(
				chunk.map((f) => ({
					snapshotId: snapId,
					...f,
					firstAt: new Date(f.firstAt),
					lastAt: new Date(f.lastAt)
				}))
			)
			.run()
	);
	await insertAll(history.blame, (chunk) =>
		db
			.insert(blameRange)
			.values(chunk.map((r) => ({ snapshotId: snapId, ...r })))
			.run()
	);
	await insertAll(history.authors, (chunk) =>
		db
			.insert(gitAuthor)
			.values(
				chunk.map((a) => ({
					snapshotId: snapId,
					...a,
					firstAt: new Date(a.firstAt),
					lastAt: new Date(a.lastAt)
				}))
			)
			.run()
	);
	await insertAll(history.coChanges, (chunk) =>
		db
			.insert(edge)
			.values(
				chunk.map((p) => ({
					snapshotId: snapId,
					from: `file:${p.a}`,
					to: `file:${p.b}`,
					kind: 'co_changes' as const,
					method: 'git_cochange' as const,
					resolution: 'resolved' as const,
					weight: p.count,
					evidence: { count: p.count, strength: p.strength, shas: p.shas }
				}))
			)
			.run()
	);
}
