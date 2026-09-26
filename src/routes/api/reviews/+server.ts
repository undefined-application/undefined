import { error, json } from '@sveltejs/kit';
import { getGithubToken } from '$lib/server/github';
import { createReview, listReviews } from '$lib/server/review';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => json(listReviews(locals.user!.id));

/** Body: `{ owner, repo, pr_number }` or `{ repo: "owner/name", pr_number }` (plan §6.2). */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => error(400, 'Body must be JSON'));
	const token = await getGithubToken(locals.user!.id);
	const repo = body.owner ? `${body.owner}/${body.repo}` : body.repo;
	const { reviewId } = await createReview(locals.user!.id, token, {
		repo,
		number: Number(body.pr_number)
	});
	return json({ review_id: reviewId }, { status: 201 });
};
