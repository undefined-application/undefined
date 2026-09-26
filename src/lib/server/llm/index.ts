// The app's LLM instance: env config + SQLite cache. `llm()` is null when no broker is configured,
// and every caller must work without it (deterministic output only).
// Providers: one per (broker, key) from LLM_KEYS_<BROKER> (brokers.ts), in LLM_BROKER_ORDER.
// A legacy LLM_BASE_URL/LLM_API_KEY pair (standard model ids) goes first.

import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { llmCall } from '$lib/server/db/schema';
import { BROKERS, keysVar, STANDARD_MODELS } from './brokers';
import { createLlm, type Llm, type Provider } from './core';

export { parseJsonLoose, type ChatMessage, type ChatResult } from './core';

let instance: Llm | null | undefined;

export function llm(): Llm | null {
	if (instance !== undefined) return instance;
	const providers = configuredProviders();
	if (!providers.length) return (instance = null);
	instance = createLlm({
		providers,
		fallbackModels: list(env.LLM_MODEL_FALLBACK ?? 'zai-org/GLM-5.3-Flash'),
		models: {
			fast: env.LLM_MODEL_FAST || 'MiniMaxAI/MiniMax-M2.7',
			strong: env.LLM_MODEL_STRONG || 'deepseek-ai/DeepSeek-V4-Flash-0731'
		},
		cache: {
			get: (hash) => db.select().from(llmCall).where(eq(llmCall.hash, hash)).get(),
			set: (hash, promptId, call) =>
				void db
					.insert(llmCall)
					.values({ hash, promptId, ...call })
					.onConflictDoNothing()
					.run()
		}
	});
	return instance;
}

const list = (v: string | undefined) =>
	(v ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

function configuredProviders(): Provider[] {
	const out: Provider[] = [];
	const seen = new Set<string>();
	const add = (name: string, baseURL: string, apiKey: string, models: Record<string, string>) => {
		if (seen.has(`${baseURL} ${apiKey}`)) return;
		seen.add(`${baseURL} ${apiKey}`);
		out.push({ name, baseURL, apiKey, models });
	};
	if (env.LLM_BASE_URL && env.LLM_API_KEY)
		add('custom', env.LLM_BASE_URL, env.LLM_API_KEY, STANDARD_MODELS);
	const order = list(env.LLM_BROKER_ORDER);
	const brokers = order.length
		? order.flatMap((id) => BROKERS.filter((b) => b.id === id))
		: BROKERS;
	for (const b of brokers)
		list(env[keysVar(b.id)]).forEach((key, i) => add(`${b.id}#${i + 1}`, b.baseURL, key, b.models));
	return out;
}
