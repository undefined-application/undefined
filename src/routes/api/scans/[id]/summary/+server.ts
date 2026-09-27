import { error, json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { scanRun } from '$lib/server/db/schema';
import { getGithubToken } from '$lib/server/github';
import { llm } from '$lib/server/llm';
import { loadModel } from '$lib/server/scan/model';
import { scanOverview } from '$lib/server/scan/overview';
import type { RequestHandler } from './$types';

/** The stored overview, or null when none was generated yet (the wiki then POSTs). */
export const GET: RequestHandler = async ({ locals, params }) => {
	const row = db
		.select({ overview: scanRun.overview })
		.from(scanRun)
		.where(and(eq(scanRun.id, params.id), eq(scanRun.userId, locals.user!.id)))
		.get();
	if (!row) error(404, 'Scan not found');
	return json({ overview: row.overview ?? null });
};

/** The model's part of the wiki: intro, architecture layers, start files. Generated once, then stored. */
export const POST: RequestHandler = async ({ locals, params }) => {
	const model = llm();
	if (!model) error(503, 'No LLM configured');
	const view = loadModel(locals.user!.id, params.id);
	const overview = await scanOverview(
		view,
		params.id,
		await getGithubToken(locals.user!.id),
		model
	).catch((e: Error) => error(502, `Model error: ${e.message}`));
	return json(overview);
};
