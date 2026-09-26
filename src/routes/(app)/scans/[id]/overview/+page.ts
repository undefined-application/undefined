import { getJson } from '$lib/api';
import type { FenceReport, OnboardingPack } from '$lib/model';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params, parent }) => {
	// Re-runs whenever the layout's scan poll refreshes; the pack exists once the scan is done.
	const { scan } = await parent();
	if (scan.status !== 'done') return { pack: null, packError: null, fences: null };
	// Streamed: the first visit traces line history in the clone (a few seconds), so the page
	// renders first. Marked handled so a rejection can't crash SSR; the page shows the error.
	const fences = getJson<FenceReport>(fetch, `/api/scans/${params.id}/fences`);
	fences.catch(() => {});
	const res = await fetch(`/api/scans/${params.id}/docs`);
	if (!res.ok) {
		const message = (await res.json().catch(() => null))?.message ?? res.statusText;
		return { pack: null, packError: message as string, fences: null };
	}
	return { pack: (await res.json()) as OnboardingPack, packError: null, fences };
};
