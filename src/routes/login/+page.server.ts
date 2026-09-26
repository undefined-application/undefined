import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { Actions, PageServerLoad } from './$types';
import { auth, githubAuthEnabled } from '$lib/server/auth';
import { GUEST_COOKIE } from '$lib/server/guest';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) redirect(302, '/');
	return { githubEnabled: githubAuthEnabled };
};

export const actions: Actions = {
	github: async () => {
		if (!githubAuthEnabled) return fail(400, { message: 'GitHub sign-in is not configured' });
		const result = await auth.api.signInSocial({
			body: { provider: 'github', callbackURL: '/' }
		});
		if (result.url) redirect(302, result.url);
		return fail(400, { message: 'GitHub sign-in failed' });
	},
	/** Guest mode, only when no GitHub OAuth app is configured. */
	guest: async ({ cookies }) => {
		if (githubAuthEnabled) return fail(400, { message: 'Sign in with GitHub' });
		cookies.set(GUEST_COOKIE, '1', {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: !dev,
			maxAge: 60 * 60 * 24 * 365
		});
		redirect(303, '/');
	}
};
