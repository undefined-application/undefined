import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { GUEST_COOKIE } from '$lib/server/guest';
import type { RequestHandler } from './$types';

/** Server-side sign-out: deletes the session row and clears the cookie, then back to /login. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	await auth.api.signOut({ headers: request.headers }).catch(() => {});
	cookies.delete(GUEST_COOKIE, { path: '/' });
	redirect(303, '/login');
};
