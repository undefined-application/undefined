import { apiFetch } from '$lib/api';
import { toast } from 'svelte-sonner';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { ScanSummary } from '$lib/scan';

/** Scan the same repo, branch and scopes again (instant when the commit hasn't moved). */
export async function rescan(scan: ScanSummary) {
	const res = await apiFetch('/api/scans', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			repo: scan.repo,
			ref: scan.ref,
			subpath: scan.deepScope,
			reference_scope: scan.referenceScope
		})
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) {
		toast.error('Could not start the scan', { description: body?.message ?? res.statusText });
		return;
	}
	await goto(resolve(`/scans/${body.scan_id}/overview`));
}
