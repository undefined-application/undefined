import { json } from '@sveltejs/kit';
import { getGithubToken } from '$lib/server/github';
import { fences, loadModel, onboardingPack, packMarkdown } from '$lib/server/scan/model';
import type { RequestHandler } from './$types';

/** Onboarding pack (plan §6.2). `?format=md` downloads it as Markdown, with "What not to break". */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const model = loadModel(locals.user!.id, params.id);
	const pack = onboardingPack(model);
	if (url.searchParams.get('format') !== 'md') return json(pack);
	const report = await fences(model, await getGithubToken(locals.user!.id));
	const name = `${pack.repo.replace('/', '_')}${pack.deepScope ? `_${pack.deepScope.split('/').pop()}` : ''}.md`;
	return new Response(packMarkdown(pack, report.fences), {
		headers: {
			'content-type': 'text/markdown; charset=utf-8',
			'content-disposition': `attachment; filename="${name}"`
		}
	});
};
