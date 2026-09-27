import { getJson } from '$lib/api';
import type { FenceReport, OnboardingPack, WikiOverview } from '$lib/model';
import type { PageLoad } from './$types';

/** How long the page waits for an already traced fence report before streaming it. */
const FENCE_GRACE_MS = 400;

export const load: PageLoad = async ({ fetch, params, parent }) => {
	// Re-runs whenever the layout's scan poll refreshes; the pack exists once the scan is done.
	const { scan } = await parent();
	if (scan.status !== 'done') return { pack: null, packError: null, fences: null, overview: null };
	// The first visit traces line history in the clone (a few seconds): streamed, so the page
	// renders first. After that the server has it in memory: wait briefly and hand over the report
	// itself, so the page renders complete instead of filling in a second later. Marked handled so
	// a rejection can't crash SSR; the page shows the error.
	const tracing = getJson<FenceReport>(fetch, `/api/scans/${params.id}/fences`);
	tracing.catch(() => {});
	// Alongside the pack and the AI overview (stored once generated: no loading state for it).
	const [ready, res, stored] = await Promise.all([
		Promise.race([
			tracing.catch(() => null),
			new Promise<null>((r) => setTimeout(() => r(null), FENCE_GRACE_MS))
		]),
		fetch(`/api/scans/${params.id}/docs`),
		fetch(`/api/scans/${params.id}/summary`)
			.then(async (r) => (r.ok ? ((await r.json()).overview as WikiOverview | null) : null))
			.catch(() => null)
	]);
	const fences: FenceReport | Promise<FenceReport> = ready ?? tracing;
	if (!res.ok) {
		const message = (await res.json().catch(() => null))?.message ?? res.statusText;
		return { pack: null, packError: message as string, fences: null, overview: null };
	}
	return { pack: (await res.json()) as OnboardingPack, packError: null, fences, overview: stored };
};
