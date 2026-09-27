import { json } from '@sveltejs/kit';
import { deleteReview, getReview } from '$lib/server/review';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) =>
	json(getReview(locals.user!.id, params.id));

/** Undo the review. Nothing on GitHub changes. */
export const DELETE: RequestHandler = async ({ locals, params }) =>
	json(deleteReview(locals.user!.id, params.id));
