import { error, json } from '@sveltejs/kit';
import { getGithubToken } from '$lib/server/github';
import { llm } from '$lib/server/llm';
import { loadModel } from '$lib/server/scan/model';
import { scanOverview } from '$lib/server/scan/overview';
import type { RequestHandler } from './$types';

/** The model's part of the wiki: intro, architecture layers, start files. Cached by input hash. */
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
