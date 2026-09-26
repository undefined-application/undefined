import { redirect } from '@sveltejs/kit';
import { GUEST_USER_ID } from '$lib/server/guest';
import { llm } from '$lib/server/llm';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	// hooks.server.ts already gates; this narrows the type for pages.
	if (!locals.user) redirect(303, '/login');
	return {
		user: {
			name: locals.user.name,
			email: locals.user.email,
			image: locals.user.image,
			/** No GitHub account: public repositories only. */
			guest: locals.user.id === GUEST_USER_ID
		},
		/** Chat and the model overview need a broker; everything else works without one. */
		llmEnabled: llm() !== null
	};
};
