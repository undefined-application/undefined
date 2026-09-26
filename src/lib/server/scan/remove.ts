// Deleting a scanned repository (docs/ui-spec.md §4.2): the user's scans and reviews of it, the
// snapshots no scan uses any more, and the local clone once nobody needs it.

import { rm, rmdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { error } from '@sveltejs/kit';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
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
	gitCommit,
	review,
	scanFile,
	scanRun,
	snapshot
} from '$lib/server/db/schema';
import { forgetSnapshot } from './model';

const DATA_DIR = env.DATA_DIR || 'data';
const ACTIVE = new Set(['queued', 'running']);

/** Everything stored per snapshot. Deleted explicitly: SQLite only cascades with foreign keys on. */
const SNAPSHOT_TABLES = [
	scanFile,
	fileModel,
	codeSymbol,
	codeSignal,
	component,
	gitCommit,
	fileHistory,
	blameRange,
	gitAuthor,
	edge
];

export interface RepoDeletion {
	repo: string;
	scans: number;
	reviews: number;
	/** Snapshots removed with all their rows (kept while another scan still uses them). */
	snapshots: number;
	/** The bare clone under `$DATA_DIR/repos` (kept while anyone's scan or review uses it). */
	cloneRemoved: boolean;
}

export async function deleteRepo(userId: string, repo: string): Promise<RepoDeletion> {
	const runs = db
		.select({ id: scanRun.id, status: scanRun.status, snapshotId: scanRun.snapshotId })
		.from(scanRun)
		.innerJoin(snapshot, eq(scanRun.snapshotId, snapshot.id))
		.where(and(eq(scanRun.userId, userId), eq(snapshot.repo, repo)))
		.all();
	const reviews = db
		.select({ id: review.id, status: review.status })
		.from(review)
		.where(and(eq(review.userId, userId), eq(review.repo, repo)))
		.all();
	if (!runs.length && !reviews.length) error(404, `You have no scans or reviews of ${repo}`);
	if ([...runs, ...reviews].some((r) => ACTIVE.has(r.status)))
		error(409, `A scan or review of ${repo} is still running. Delete it once that finishes.`);

	const snapIds = [...new Set(runs.map((r) => r.snapshotId))];
	let snapshots = 0;
	db.transaction((tx) => {
		if (reviews.length)
			tx.delete(review)
				.where(
					inArray(
						review.id,
						reviews.map((r) => r.id)
					)
				)
				.run();
		if (runs.length)
			tx.delete(scanRun)
				.where(
					inArray(
						scanRun.id,
						runs.map((r) => r.id)
					)
				)
				.run();
		for (const id of snapIds) {
			const users = tx
				.select({ n: sql<number>`count(*)` })
				.from(scanRun)
				.where(eq(scanRun.snapshotId, id))
				.get();
			if (users && users.n > 0) continue;
			for (const table of SNAPSHOT_TABLES) tx.delete(table).where(eq(table.snapshotId, id)).run();
			tx.delete(snapshot).where(eq(snapshot.id, id)).run();
			snapshots++;
		}
	});
	for (const id of snapIds) forgetSnapshot(id);

	// One clone serves everyone's scans and reviews of the repo.
	const scansLeft = db
		.select({ n: sql<number>`count(*)` })
		.from(scanRun)
		.innerJoin(snapshot, eq(scanRun.snapshotId, snapshot.id))
		.where(eq(snapshot.repo, repo))
		.get();
	const reviewsLeft = db
		.select({ n: sql<number>`count(*)` })
		.from(review)
		.where(eq(review.repo, repo))
		.get();
	let cloneRemoved = false;
	if (!scansLeft?.n && !reviewsLeft?.n) {
		const root = resolve(DATA_DIR, 'repos');
		const dir = resolve(root, `${repo}.git`);
		if (dir.startsWith(root + sep)) {
			await rm(dir, { recursive: true, force: true });
			// The owner directory too, once it holds no other clone.
			await rmdir(dirname(dir)).catch(() => {});
			cloneRemoved = true;
		}
	}
	return { repo, scans: runs.length, reviews: reviews.length, snapshots, cloneRemoved };
}
