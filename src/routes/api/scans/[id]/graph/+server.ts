import { json } from '@sveltejs/kit';
import type { GraphLevel } from '$lib/model';
import { graphData, loadModel } from '$lib/server/scan/model';
import type { RequestHandler } from './$types';

/** `?level=component|file|symbol&file=<path>&cochange=1` (plan §6.2). */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const raw = url.searchParams.get('level');
	const level: GraphLevel = raw === 'file' || raw === 'symbol' ? raw : 'component';
	return json(
		graphData(loadModel(locals.user!.id, params.id), level, {
			file: url.searchParams.get('file') ?? undefined,
			coChange: url.searchParams.get('cochange') === '1'
		})
	);
};
