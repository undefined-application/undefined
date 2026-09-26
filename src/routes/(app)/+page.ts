import { getJson } from '$lib/api';
import type { RepoSummary } from '$lib/github';
import type { ReviewSummary } from '$lib/review';
import type { ScanSummary } from '$lib/scan';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, depends }) => {
	depends('app:systems');
	// Streamed: the page renders immediately and the repo list arrives for the new-scan dialog. Mark
	// it handled so a rejection (a 401 when the GitHub session is gone) can't crash the server before
	// rendering starts; the page still sees it and redirects to /login.
	const repos = getJson<RepoSummary[]>(fetch, '/api/github/repos');
	repos.catch(() => {});
	const [scans, reviews] = await Promise.all([
		getJson<ScanSummary[]>(fetch, '/api/scans'),
		getJson<ReviewSummary[]>(fetch, '/api/reviews')
	]);
	return {
		repos,
		scans,
		reviews
	};
};
