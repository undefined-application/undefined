import { json } from '@sveltejs/kit';
import { getReview } from '$lib/server/review';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) =>
	json(getReview(locals.user!.id, params.id));
