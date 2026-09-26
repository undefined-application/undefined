import { error } from '@sveltejs/kit';
import type { ScanSummary } from '$lib/scan';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ params, fetch, depends }) => {
	depends('app:scan');
	const res = await fetch(`/api/scans/${params.id}`);
	if (!res.ok) error(res.status, (await res.json().catch(() => null))?.message ?? 'Scan not found');
	return { scan: (await res.json()) as ScanSummary };
};
