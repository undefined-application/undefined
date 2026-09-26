import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/** Server-side sign-out: deletes the session row and clears the cookie, then back to /login. */
export const POST: RequestHandler = async ({ request }) => {
	await auth.api.signOut({ headers: request.headers }).catch(() => {});
	redirect(303, '/login');
};
