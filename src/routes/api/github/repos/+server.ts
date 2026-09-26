import { json } from '@sveltejs/kit';
import { getGithubToken, listRepos } from '$lib/server/github';
import type { RequestHandler } from './$types';

// hooks.server.ts already 401s anonymous /api calls.
export const GET: RequestHandler = async ({ locals }) => {
	const token = await getGithubToken(locals.user!.id);
	return json(await listRepos(token));
};
