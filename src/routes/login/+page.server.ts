import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) redirect(302, '/');
	return {};
};

export const actions: Actions = {
	github: async () => {
		const result = await auth.api.signInSocial({
			body: { provider: 'github', callbackURL: '/' }
		});
		if (result.url) redirect(302, result.url);
		return fail(400, { message: 'GitHub sign-in failed' });
	}
};
