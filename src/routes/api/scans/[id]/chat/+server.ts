import { join } from 'node:path';
import { error, json } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { runChat, type ChatTurn } from '$lib/server/chat/agent';
import { db } from '$lib/server/db';
import { scanRun } from '$lib/server/db/schema';
import { llm } from '$lib/server/llm';
import { loadModel } from '$lib/server/scan/model';
import type { RequestHandler } from './$types';

/** Body: `{ messages: [{role, content}] }` → answer + validated claims (plan §6.2). */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json().catch(() => error(400, 'Body must be JSON'));
	const turns: ChatTurn[] = (Array.isArray(body.messages) ? body.messages : [])
		.filter(
			(m: ChatTurn) =>
				(m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
		)
		.slice(-10);
	if (!turns.length || turns.at(-1)!.role !== 'user')
		error(400, 'Last message must be from the user');
	const model = llm();
	if (!model) error(503, 'No LLM configured (LLM_BASE_URL / LLM_API_KEY)');
	const view = loadModel(locals.user!.id, params.id);
	const dir = join(env.DATA_DIR || 'data', 'repos', `${view.repo}.git`);
	const answer = await runChat(view, dir, model, turns).catch((e: Error) =>
		error(502, `Model error: ${e.message}`)
	);
	db.update(scanRun)
		.set({ tokensUsed: sql`${scanRun.tokensUsed} + ${answer.tokens}` })
		.where(eq(scanRun.id, params.id))
		.run();
	return json(answer);
};
