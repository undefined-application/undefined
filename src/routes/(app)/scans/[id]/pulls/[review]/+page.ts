import { error } from '@sveltejs/kit';
import type { ReviewSummary } from '$lib/review';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params, depends }) => {
	// The page polls with invalidate('app:review') while the review runs.
	depends('app:review');
	const res = await fetch(`/api/reviews/${params.review}`);
	if (!res.ok)
		error(res.status, (await res.json().catch(() => null))?.message ?? 'Review not found');
	return { review: (await res.json()) as ReviewSummary };
};
