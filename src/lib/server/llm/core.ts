// LLM client core (plan §4.1): OpenAI-compatible (Gonka brokers), tiered models, a fallback chain
// over models and (broker, key) providers, and a cache keyed by the complete normalized input.
// No env / db imports here so it can be tested with a fake fetch and an in-memory cache.

import { createHash } from 'node:crypto';
import OpenAI from 'openai';

export type Tier = 'fast' | 'strong';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface ChatRequest {
	tier: Tier;
	/** Versioned prompt id, e.g. `review-rationale.v1`: part of the cache key. */
	promptId: string;
	messages: ChatMessage[];
	maxTokens?: number;
	temperature?: number;
}

export interface ChatResult {
	text: string;
	/** Canonical model id. */
	model: string;
	/** Provider that answered (`gonkarouter#2`), or `cache`. Never the key. */
	provider: string;
	promptTokens: number;
	completionTokens: number;
	cached: boolean;
}

export interface CachedCall {
	model: string;
	response: string;
	promptTokens: number;
	completionTokens: number;
}

export interface LlmCache {
	get(hash: string): CachedCall | undefined;
	set(hash: string, promptId: string, call: CachedCall): void;
}

/** One (broker, key) pair. */
export interface Provider {
	name: string;
	baseURL: string;
	apiKey: string;
	/** Canonical model id → this broker's id. Models not listed are skipped. */
	models: Record<string, string>;
}

export interface LlmOptions {
	/** Tried in order: the first is primary, the rest are fallbacks. */
	providers: Provider[];
	/** Canonical model ids. */
	models: Record<Tier, string>;
	/** Tried after both tier models. */
	fallbackModels?: string[];
	cache?: LlmCache;
	fetch?: typeof fetch;
	/** Retries per (provider, model) before moving on (the SDK backs off on 429/5xx). */
	maxRetries?: number;
	timeoutMs?: number;
	/** How long a provider is skipped after it rejects the key, runs out of credit or is unreachable. */
	cooldownMs?: number;
	now?: () => number;
	log?: (line: string) => void;
}

/** Plan §4.5.4: hash of the complete normalized input + prompt id/version + model + params. */
export function cacheKey(req: ChatRequest, model: string): string {
	const normalized = {
		promptId: req.promptId,
		model,
		temperature: req.temperature ?? 0,
		maxTokens: req.maxTokens ?? 4000,
		messages: req.messages.map((m) => ({
			role: m.role,
			content: m.content.replace(/\r\n/g, '\n').trim()
		}))
	};
	return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * What a failed attempt means for the next one:
 * - `model`: this model is busy or missing here (429, 5xx, 404): try the next model.
 * - `provider`: this key or broker is unusable (bad key, no credit, unreachable): skip it a while.
 * - `fatal`: the request itself is wrong (400, 422): every attempt would fail the same way.
 */
export function classify(err: unknown): 'model' | 'provider' | 'fatal' {
	const status = (err as { status?: number }).status;
	if (status === undefined || status === 401 || status === 402 || status === 403) return 'provider';
	if (status === 404 || status === 408 || status === 409 || status === 429 || status >= 500)
		return 'model';
	return 'fatal';
}

export function createLlm(opts: LlmOptions) {
	if (!opts.providers.length) throw new Error('createLlm: no providers');
	const now = opts.now ?? Date.now;
	const log = opts.log ?? ((line: string) => console.warn(line));
	const cooldownMs = opts.cooldownMs ?? 5 * 60_000;
	const providers = opts.providers.map((p) => ({
		name: p.name,
		models: p.models,
		client: new OpenAI({
			baseURL: p.baseURL,
			apiKey: p.apiKey,
			maxRetries: opts.maxRetries ?? 1,
			timeout: opts.timeoutMs ?? 120_000,
			fetch: opts.fetch
		}),
		downUntil: 0
	}));

	const chain = (tier: Tier) => [
		...new Set([
			opts.models[tier],
			opts.models[tier === 'fast' ? 'strong' : 'fast'],
			...(opts.fallbackModels ?? [])
		])
	];

	function fromCache(req: ChatRequest, models: string[]): ChatResult | undefined {
		for (const model of models) {
			const hit = opts.cache?.get(cacheKey(req, model));
			if (hit)
				return {
					text: hit.response,
					model: hit.model,
					provider: 'cache',
					promptTokens: hit.promptTokens,
					completionTokens: hit.completionTokens,
					cached: true
				};
		}
	}

	async function callModel(
		p: (typeof providers)[number],
		req: ChatRequest,
		model: string
	): Promise<ChatResult> {
		const res = await p.client.chat.completions.create({
			model: p.models[model],
			messages: req.messages,
			temperature: req.temperature ?? 0,
			max_tokens: req.maxTokens ?? 4000
		});
		const text = res.choices[0]?.message?.content ?? '';
		const result = {
			text,
			model,
			provider: p.name,
			promptTokens: res.usage?.prompt_tokens ?? 0,
			completionTokens: res.usage?.completion_tokens ?? 0,
			cached: false
		};
		if (text)
			opts.cache?.set(cacheKey(req, model), req.promptId, {
				model,
				response: text,
				promptTokens: result.promptTokens,
				completionTokens: result.completionTokens
			});
		return result;
	}

	return {
		models: opts.models,
		providers: opts.providers.map((p) => p.name),
		/**
		 * Cache first (any model in the chain), then each healthy provider in order, and within it
		 * each model it serves: tier model, other tier model, fallback models. A provider that fails
		 * as a whole is skipped for `cooldownMs`; if every provider is cooling down, all are tried.
		 */
		async chat(req: ChatRequest): Promise<ChatResult> {
			const models = chain(req.tier);
			const hit = fromCache(req, models);
			if (hit) return hit;
			const healthy = providers.filter((p) => p.downUntil <= now());
			let lastErr: unknown = new Error('LLM: no provider serves the requested models');
			for (const p of healthy.length ? healthy : providers) {
				for (const model of models.filter((m) => m in p.models)) {
					try {
						return await callModel(p, req, model);
					} catch (err) {
						lastErr = err;
						const kind = classify(err);
						const status = (err as { status?: number }).status ?? 'network';
						if (kind === 'fatal') throw err;
						if (kind === 'provider') {
							p.downUntil = now() + cooldownMs;
							log(`[llm] ${p.name} ${status} → cooldown, next provider`);
							break;
						}
						log(`[llm] ${p.name} ${model} ${status} → next model`);
					}
				}
			}
			throw lastErr;
		}
	};
}

export type Llm = ReturnType<typeof createLlm>;

/** Models wrap JSON in fences or prefix reasoning (`<think>…</think>`): take the outermost object. */
export function parseJsonLoose<T = unknown>(text: string): T {
	const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
	// Models sometimes repeat the object or wrap it in prose: take the first balanced top-level
	// object that parses, not first "{" to last "}".
	for (const candidate of jsonObjects(cleaned)) {
		for (const attempt of [candidate, repairJson(candidate)]) {
			try {
				return JSON.parse(attempt) as T;
			} catch {
				// Try the repaired text, then the next object.
			}
		}
	}
	throw new Error('LLM response has no JSON object');
}

/**
 * Fix what models commonly get wrong in otherwise valid JSON: raw newlines/tabs inside strings
 * (quoted source code) and trailing commas before `}` or `]`.
 */
export function repairJson(text: string): string {
	let out = '';
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inString) {
			if (c === '\\') {
				out += c + (text[i + 1] ?? '');
				i++;
			} else if (c === '"') {
				inString = false;
				out += c;
			} else if (c === '\n') out += '\\n';
			else if (c === '\r') out += '\\r';
			else if (c === '\t') out += '\\t';
			else if (c < ' ') out += `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
			else out += c;
		} else {
			if (c === '"') inString = true;
			out += c;
		}
	}
	return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * The string value of `key` in JSON-ish text that does not parse (cut off, broken later on), or
 * null. Lets a chat answer survive a malformed claims list instead of showing raw JSON.
 */
export function extractJsonString(text: string, key: string): string | null {
	const m = new RegExp(`"${key}"\\s*:\\s*"`).exec(text);
	if (!m) return null;
	let raw = '';
	for (let i = m.index + m[0].length; i < text.length; i++) {
		const c = text[i];
		if (c === '\\') {
			raw += c + (text[i + 1] ?? '');
			i++;
		} else if (c === '"') break;
		else raw += c;
	}
	try {
		return JSON.parse(repairJson(`"${raw}"`)) as string;
	} catch {
		return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"');
	}
}

/** Every top-level JSON object in a response that parses (models sometimes split one answer into several). */
export function parseJsonAll<T = unknown>(text: string): T[] {
	const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
	const out: T[] = [];
	for (const candidate of jsonObjects(cleaned)) {
		try {
			out.push(JSON.parse(candidate) as T);
		} catch {
			// Skip the fragment.
		}
	}
	return out;
}

/** Top-level `{...}` spans, string- and escape-aware. */
function* jsonObjects(text: string): Generator<string> {
	let depth = 0;
	let start = -1;
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inString) {
			if (c === '\\') i++;
			else if (c === '"') inString = false;
		} else if (c === '"') {
			if (depth > 0) inString = true;
		} else if (c === '{') {
			if (depth++ === 0) start = i;
		} else if (c === '}' && depth > 0 && --depth === 0) {
			yield text.slice(start, i + 1);
		}
	}
}
