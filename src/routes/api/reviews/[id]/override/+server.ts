import { error, json } from '@sveltejs/kit';
import { addOverride } from '$lib/server/review';
import type { RequestHandler } from './$types';

/** Body: `{ verdict, reason }`. Human-only override of the rule floor (plan §5 step 8). */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json().catch(() => error(400, 'Body must be JSON'));
	const user = locals.user!;
	return json(addOverride(user.id, user.name || user.email, params.id, body));
};
