import { json } from '@sveltejs/kit';
import { getGithubToken, listBranches } from '$lib/server/github';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const token = await getGithubToken(locals.user!.id);
	return json(await listBranches(token, params.owner, params.repo));
};
