// Tab 4 orchestration: create → queue → run → store; read; human overrides (plan §5 Tab 4, §6.2).

import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import type { Override, ReviewSummary, Verdict } from '$lib/review';
import { VERDICT_RANK } from '$lib/review';
import { db } from '$lib/server/db';
import { review, scanRun, snapshot } from '$lib/server/db/schema';
import { commitAuthorLogin, getPull, parseRepo } from '$lib/server/github';
import { enqueue } from '$lib/server/jobs/queue';
import { llm } from '$lib/server/llm';
import { ensureCommit, ensurePullHead } from '$lib/server/scan/acquire';
import { analyzePull } from './engine';
import { explainWithLlm } from './explain';

const DATA_DIR = env.DATA_DIR || 'data';

export async function createReview(
	userId: string,
	token: string,
	input: { repo: string; number: number }
) {
	const parsed = parseRepo(input.repo ?? '');
	if (!parsed) error(400, 'repo must be "owner/name" or a github.com URL');
	if (!Number.isInteger(input.number) || input.number <= 0)
		error(400, 'number must be a PR number');
	const pull = await getPull(token, parsed.owner, parsed.name, input.number);
	const id = crypto.randomUUID();
	db.insert(review)
		.values({
			id,
			userId,
			repo: `${parsed.owner}/${parsed.name}`,
			prNumber: pull.number,
			title: pull.title
		})
		.run();
	enqueue(() => runReview(id, userId, token));
	return { reviewId: id };
}

async function runReview(id: string, userId: string, token: string) {
	const set = (values: Partial<typeof review.$inferInsert>) =>
		db.update(review).set(values).where(eq(review.id, id)).run();
	try {
		const row = db.select().from(review).where(eq(review.id, id)).get();
		if (!row) return;
		const [owner, name] = row.repo.split('/');
		set({ status: 'running', stage: 'Fetching the PR' });
		const pull = await getPull(token, owner, name, row.prNumber);
		const dir = join(DATA_DIR, 'repos', `${row.repo}.git`);
		const auth = { token };
		await ensureCommit({
			url: `https://github.com/${row.repo}.git`,
			dir,
			commitSha: pull.baseSha,
			auth
		});
		await ensurePullHead({ dir, number: pull.number, headSha: pull.headSha, auth });

		// The user's latest finished scan of this repo decides the deep scope, if it covers the change.
		const scan = db
			.select({ id: scanRun.id, deepScope: snapshot.deepScope })
			.from(scanRun)
			.innerJoin(snapshot, eq(scanRun.snapshotId, snapshot.id))
			.where(
				and(eq(scanRun.userId, userId), eq(snapshot.repo, row.repo), eq(scanRun.status, 'done'))
			)
			.orderBy(desc(scanRun.createdAt))
			.get();

		const analysis = await analyzePull({
			dir,
			repo: row.repo,
			pull,
			scanScope: scan ? { deepScope: scan.deepScope, scanId: scan.id } : null,
			auth,
			onStage: (stage) => set({ stage }),
			lookupLogin: async (sha) => (await commitAuthorLogin(token, owner, name, sha))?.login ?? null
		});

		const model = llm();
		if (model) {
			set({ stage: 'Asking the model for a rationale' });
			try {
				await explainWithLlm(analysis, model);
			} catch (err) {
				// The deterministic review stands on its own; say why the model part is missing.
				analysis.result.llm = {
					used: false,
					downgrades: 0,
					error: (err as Error).message.slice(0, 300)
				};
			}
		} else {
			analysis.result.llm = {
				used: false,
				downgrades: 0,
				error: 'No LLM configured (LLM_BASE_URL / LLM_API_KEY)'
			};
		}

		set({
			status: 'done',
			stage: null,
			title: pull.title,
			verdict: analysis.result.verdict,
			result: analysis.result,
			finishedAt: new Date()
		});
	} catch (err) {
		console.error(`[review ${id}] failed`, err);
		set({
			status: 'failed',
			stage: null,
			error: (err as Error).message.slice(0, 500),
			finishedAt: new Date()
		});
	}
}

function toSummary(row: typeof review.$inferSelect): ReviewSummary {
	const last = row.overrides.at(-1);
	return {
		id: row.id,
		repo: row.repo,
		prNumber: row.prNumber,
		title: row.title,
		status: row.status,
		stage: row.stage,
		error: row.error,
		verdict: last?.verdict ?? row.verdict ?? null,
		engineVerdict: row.verdict ?? null,
		createdAt: row.createdAt.toISOString(),
		finishedAt: row.finishedAt?.toISOString() ?? null,
		result: row.result ?? null,
		overrides: row.overrides
	};
}

export function getReview(userId: string, id: string): ReviewSummary {
	const row = db
		.select()
		.from(review)
		.where(and(eq(review.id, id), eq(review.userId, userId)))
		.get();
	if (!row) error(404, 'Review not found');
	return toSummary(row);
}

/** List without the heavy result documents. */
export function listReviews(userId: string, limit = 30): ReviewSummary[] {
	return db
		.select()
		.from(review)
		.where(eq(review.userId, userId))
		.orderBy(desc(review.createdAt))
		.limit(limit)
		.all()
		.map((r) => ({ ...toSummary(r), result: null }));
}

/**
 * Plan §5 step 8: only a human can move the verdict below the rule floor, with a written reason.
 * Stored and shown ("floor DANGEROUS, overridden to RISKY by @user: reason").
 */
export function addOverride(
	userId: string,
	userName: string,
	id: string,
	input: { verdict: string; reason: string }
) {
	const current = getReview(userId, id);
	if (current.status !== 'done') error(409, 'Review is not finished');
	const verdict = input.verdict?.toUpperCase() as Verdict;
	if (!(verdict in VERDICT_RANK)) error(400, 'verdict must be SAFE, RISKY, DANGEROUS or STOP');
	const reason = (input.reason ?? '').trim();
	if (reason.length < 10) error(400, 'A written reason (at least 10 characters) is required');
	const override: Override = {
		verdict,
		reason: reason.slice(0, 1000),
		user: userName,
		at: new Date().toISOString()
	};
	db.update(review)
		.set({ overrides: [...current.overrides, override] })
		.where(eq(review.id, id))
		.run();
	return getReview(userId, id);
}

/**
 * Undo a review: the row goes, and the PR shows as unreviewed again (or as its earlier review).
 * A review still in the queue or running finishes into nothing: its updates hit no row.
 */
export function deleteReview(userId: string, id: string) {
	getReview(userId, id);
	db.delete(review)
		.where(and(eq(review.id, id), eq(review.userId, userId)))
		.run();
	return { deleted: id };
}

export function markInterruptedReviews() {
	db.update(review)
		.set({
			status: 'failed',
			stage: null,
			error: 'Server restarted before the review finished',
			finishedAt: new Date()
		})
		.where(inArray(review.status, ['queued', 'running']))
		.run();
}
