import { redirect } from '@sveltejs/kit';
import { llm } from '$lib/server/llm';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	// hooks.server.ts already gates; this narrows the type for pages.
	if (!locals.user) redirect(303, '/login');
	return {
		user: { name: locals.user.name, email: locals.user.email, image: locals.user.image },
		/** Chat and the model overview need a broker; everything else works without one. */
		llmEnabled: llm() !== null
	};
};
