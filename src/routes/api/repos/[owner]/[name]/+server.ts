import { error, json } from '@sveltejs/kit';
import { parseRepo } from '$lib/server/github';
import { deleteRepo } from '$lib/server/scan/remove';
import type { RequestHandler } from './$types';

/** Delete every scan and review of this repo for the signed-in user (docs/ui-spec.md §4.2). */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const parsed = parseRepo(`${params.owner}/${params.name}`);
	if (!parsed || parsed.owner.startsWith('.') || parsed.name.startsWith('.'))
		error(400, 'Not a repository name');
	return json(await deleteRepo(locals.user!.id, `${parsed.owner}/${parsed.name}`));
};
