import { json } from '@sveltejs/kit';
import { getScan } from '$lib/server/scan';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) =>
	json(await getScan(locals.user!.id, params.id));
