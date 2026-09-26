import { json } from '@sveltejs/kit';
import { getGithubToken, listPulls } from '$lib/server/github';
import type { RequestHandler } from './$types';

/** `?state=open|closed` (plan §6.2). Most recently updated first, one page. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const token = await getGithubToken(locals.user!.id);
	const state = url.searchParams.get('state') === 'closed' ? 'closed' : 'open';
	return json(await listPulls(token, params.owner, params.repo, state));
};
