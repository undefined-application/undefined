import { json } from '@sveltejs/kit';
import { getGithubToken, getRepo } from '$lib/server/github';
import type { RequestHandler } from './$types';

/** Any repo the token can read, e.g. a public repo the user doesn't own (plan §5 Tab 1). */
export const GET: RequestHandler = async ({ locals, params }) => {
	const token = await getGithubToken(locals.user!.id);
	return json(await getRepo(token, params.owner, params.repo));
};
