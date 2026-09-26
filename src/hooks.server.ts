import { error, redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { markInterruptedReviews } from '$lib/server/review';
import { markInterruptedScans } from '$lib/server/scan';
import { svelteKitHandler } from 'better-auth/svelte-kit';

export const init: ServerInit = () => {
	if (building) return;
	markInterruptedScans();
	markInterruptedReviews();
};

const PUBLIC_PATHS = ['/login', '/api/auth'];

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

/** Login gate (plan §6.1): pages redirect to /login, API routes return 401. */
const handleGate: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

	if (!event.locals.user && !isPublic) {
		if (pathname.startsWith('/api/')) error(401, 'Not signed in');
		redirect(303, '/login');
	}

	return resolve(event);
};

export const handle: Handle = sequence(handleBetterAuth, handleGate);
