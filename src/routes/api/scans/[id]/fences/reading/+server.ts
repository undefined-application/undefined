import { error, json } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { scanRun } from '$lib/server/db/schema';
import { getGithubToken } from '$lib/server/github';
import { llm } from '$lib/server/llm';
import { fenceReading, fences, loadModel } from '$lib/server/scan/model';
import type { RequestHandler } from './$types';

/** `?fence=<id>` → the model's reading of one "What not to break" fence. Cached by input hash. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const id = url.searchParams.get('fence');
	if (!id) error(400, 'fence is required');
	const model = llm();
	if (!model) error(503, 'No LLM configured');
	const view = loadModel(locals.user!.id, params.id);
	const report = await fences(view, await getGithubToken(locals.user!.id));
	const fence = report.fences.find((f) => f.id === id);
	if (!fence) error(404, 'No such fence in this scan');
	const { tokens, ...reading } = await fenceReading(view, fence, model).catch((e: Error) =>
		error(502, `Model error: ${e.message}`)
	);
	if (!reading.cached) {
		db.update(scanRun)
			.set({ tokensUsed: sql`${scanRun.tokensUsed} + ${tokens}` })
			.where(eq(scanRun.id, params.id))
			.run();
	}
	return json(reading);
};
