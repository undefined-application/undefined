import { error, json } from '@sveltejs/kit';
import { impactOf, loadModel, nodeDetails, reachOf } from '$lib/server/scan/model';
import type { RequestHandler } from './$types';

/**
 * Node details (plan §6.2 `/nodes/{node_id}`; ids contain `/` and `#`, so they go in the query):
 * `?id=<node>` → details and reach (share of the system that depends on it); add
 * `&impact=<depth>` for the blast radius list from that node.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const id = url.searchParams.get('id');
	if (!id) error(400, 'id is required');
	const model = loadModel(locals.user!.id, params.id);
	const depth = url.searchParams.get('impact');
	return json({
		details: nodeDetails(model, id),
		reach: reachOf(model, id),
		impact: depth ? impactOf(model, id, Number(depth) || 3) : null
	});
};
