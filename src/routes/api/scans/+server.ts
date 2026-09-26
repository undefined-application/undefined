import { error, json } from '@sveltejs/kit';
import { getGithubToken } from '$lib/server/github';
import { createScan, listScans } from '$lib/server/scan';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => json(await listScans(locals.user!.id));

/** Body: `{ repo: "owner/name" | url, ref?, subpath?, reference_scope?: "repo" | "subpath" }` (plan §6.2). */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => error(400, 'Body must be JSON'));
	const token = await getGithubToken(locals.user!.id);
	const { scanId, snapshotId } = await createScan(locals.user!.id, token, {
		repo: body.repo,
		ref: body.ref,
		subpath: body.subpath,
		referenceScope: body.reference_scope
	});
	return json({ scan_id: scanId, snapshot_id: snapshotId }, { status: 201 });
};
