import { apiFetch } from '$lib/api';
import type { ReviewSummary } from '$lib/review';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, parent }) => {
	const { scan } = await parent();
	const res = await apiFetch('/api/reviews', undefined, fetch);
	const all: ReviewSummary[] = res.ok ? await res.json() : [];
	return { reviews: all.filter((r) => r.repo === scan.repo) };
};
