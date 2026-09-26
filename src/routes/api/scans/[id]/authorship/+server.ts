import { error, json } from '@sveltejs/kit';
import { getGithubToken } from '$lib/server/github';
import { authorship, loadModel } from '$lib/server/scan/model';
import type { RequestHandler } from './$types';

/** `?path=&line=` → last modified by (blame) + introduced by (best effort) (plan §3 rule 3). */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const path = url.searchParams.get('path');
	const line = Number(url.searchParams.get('line'));
	if (!path || !Number.isInteger(line) || line < 1) error(400, 'path and line are required');
	const model = loadModel(locals.user!.id, params.id);
	const token = await getGithubToken(locals.user!.id);
	return json(await authorship(model, token, path, line));
};
