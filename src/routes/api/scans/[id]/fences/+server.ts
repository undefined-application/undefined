import { json } from '@sveltejs/kit';
import { getGithubToken } from '$lib/server/github';
import { fences, loadModel } from '$lib/server/scan/model';
import type { RequestHandler } from './$types';

/** "What not to break" (docs/ui-spec.md §4.3): traced once per snapshot, then served from memory. */
export const GET: RequestHandler = async ({ locals, params }) => {
	const model = loadModel(locals.user!.id, params.id);
	const token = await getGithubToken(locals.user!.id);
	return json(await fences(model, token));
};
