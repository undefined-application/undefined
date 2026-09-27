import { describe, expect, it } from 'vitest';
import {
	cacheKey,
	createLlm,
	extractJsonString,
	parseJsonLoose,
	type CachedCall,
	type ChatRequest
} from './core';

const req: ChatRequest = {
	tier: 'fast',
	promptId: 'p.v1',
	messages: [{ role: 'user', content: 'hi' }]
};

/**
 * `plan` keys are `model` or `host/model`; each call pops the next status (default 200). Status 0
 * answers 200 with no text, like a reasoning model that ran out of tokens while thinking.
 */
function fakeServer(plan: Record<string, number[]>) {
	const calls: string[] = [];
	const fakeFetch = (async (url: string, init: RequestInit) => {
		const model = JSON.parse(String(init.body)).model as string;
		const host = new URL(String(url)).hostname;
		calls.push(host === 'a.test' ? model : `${host}/${model}`);
		const status = (plan[`${host}/${model}`] ?? plan[model])?.shift() ?? 200;
		if (status !== 200 && status !== 0)
			return new Response(JSON.stringify({ error: { message: 'busy' } }), { status });
		return new Response(
			JSON.stringify({
				id: 'x',
				object: 'chat.completion',
				created: 0,
				model,
				choices: [
					{
						index: 0,
						finish_reason: status === 0 ? 'length' : 'stop',
						message: { role: 'assistant', content: status === 0 ? '' : `answer from ${model}` }
					}
				],
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		);
	}) as unknown as typeof fetch;
	return { fetch: fakeFetch, calls };
}

function memoryCache() {
	const m = new Map<string, CachedCall>();
	return {
		get: (h: string) => m.get(h),
		set: (h: string, _p: string, c: CachedCall) => void m.set(h, c),
		size: () => m.size
	};
}

const standard = { 'fast-m': 'fast-m', 'strong-m': 'strong-m', glm: 'glm' };
const provider = (name: string, models: Record<string, string> = standard) => ({
	name,
	baseURL: `http://${name}.test/v1`,
	apiKey: 'k',
	models
});

const opts = {
	providers: [provider('a')],
	models: { fast: 'fast-m', strong: 'strong-m' },
	maxRetries: 0,
	log: () => {}
};
const two = { ...opts, providers: [provider('a'), provider('b')] };

describe('llm core', () => {
	it('treats an empty answer as a model failure: next model, nothing cached', async () => {
		const server = fakeServer({ 'fast-m': [0] });
		const cache = memoryCache();
		const llm = createLlm({ ...opts, fetch: server.fetch, cache });
		const a = await llm.chat(req);
		expect(a).toMatchObject({ model: 'strong-m', text: 'answer from strong-m', provider: 'a' });
		expect(server.calls).toEqual(['fast-m', 'strong-m']);
		expect(cache.size()).toBe(1);
	});

	it('answers, counts tokens, and serves an identical request from cache', async () => {
		const server = fakeServer({});
		const cache = memoryCache();
		const llm = createLlm({ ...opts, fetch: server.fetch, cache });
		const a = await llm.chat(req);
		const b = await llm.chat(req);
		expect(a).toMatchObject({
			text: 'answer from fast-m',
			promptTokens: 10,
			completionTokens: 5,
			cached: false
		});
		expect(b.cached).toBe(true);
		expect(server.calls).toEqual(['fast-m']);
	});

	it('falls back to the other model when the primary is out of capacity (429)', async () => {
		const server = fakeServer({ 'fast-m': [429] });
		const llm = createLlm({ ...opts, fetch: server.fetch });
		const r = await llm.chat(req);
		expect(r.model).toBe('strong-m');
		expect(server.calls).toEqual(['fast-m', 'strong-m']);
	});

	it('walks the whole model chain, then answers from the fallback model', async () => {
		const server = fakeServer({ 'fast-m': [429], 'strong-m': [503] });
		const llm = createLlm({ ...opts, fallbackModels: ['glm'], fetch: server.fetch });
		expect(await llm.chat(req)).toMatchObject({ model: 'glm', provider: 'a' });
		expect(server.calls).toEqual(['fast-m', 'strong-m', 'glm']);
	});

	it("sends the broker's own model id and skips models it does not serve", async () => {
		const server = fakeServer({ 'fast-m': [429] });
		const odd = provider('b', { 'strong-m': 'strong-lower' });
		const llm = createLlm({
			...opts,
			providers: [odd],
			fallbackModels: ['glm'],
			fetch: server.fetch
		});
		const r = await llm.chat(req);
		expect(r).toMatchObject({ model: 'strong-m', provider: 'b', text: 'answer from strong-lower' });
		expect(server.calls).toEqual(['b.test/strong-lower']);
	});

	it('switches key when one is out of credit, and skips it while cooling down', async () => {
		const server = fakeServer({ 'fast-m': [402] });
		let t = 0;
		const llm = createLlm({ ...two, fetch: server.fetch, now: () => t, cooldownMs: 1000 });
		expect(await llm.chat(req)).toMatchObject({ provider: 'b', model: 'fast-m' });
		await llm.chat({ ...req, promptId: 'p.v2' });
		expect(server.calls).toEqual(['fast-m', 'b.test/fast-m', 'b.test/fast-m']);
		t = 2000;
		expect(await llm.chat({ ...req, promptId: 'p.v3' })).toMatchObject({ provider: 'a' });
	});

	it('tries the next provider when every model on the first is busy', async () => {
		const server = fakeServer({ 'fast-m': [429], 'strong-m': [429] });
		const llm = createLlm({ ...two, fetch: server.fetch });
		expect(await llm.chat(req)).toMatchObject({ provider: 'b', model: 'fast-m' });
		expect(server.calls).toEqual(['fast-m', 'strong-m', 'b.test/fast-m']);
	});

	it('serves a cached answer whichever provider produced it', async () => {
		const server = fakeServer({ 'a.test/fast-m': [429, 429], 'a.test/strong-m': [429, 429] });
		const cache = memoryCache();
		const llm = createLlm({ ...two, fetch: server.fetch, cache });
		await llm.chat(req);
		expect(await llm.chat(req)).toMatchObject({ cached: true, provider: 'cache' });
		expect(server.calls).toHaveLength(3);
	});

	it('throws the last error when nothing answers', async () => {
		const server = fakeServer({ 'fast-m': [429, 429], 'strong-m': [429, 429] });
		const llm = createLlm({ ...two, fetch: server.fetch });
		await expect(llm.chat(req)).rejects.toMatchObject({ status: 429 });
		expect(server.calls).toHaveLength(4);
	});

	it('does not fall back on a client error', async () => {
		const server = fakeServer({ 'fast-m': [400] });
		const llm = createLlm({ ...opts, fetch: server.fetch });
		await expect(llm.chat(req)).rejects.toThrow();
		expect(server.calls).toEqual(['fast-m']);
	});

	it('cache key changes with any input: message, prompt version, model', () => {
		const k = cacheKey(req, 'm');
		expect(cacheKey({ ...req }, 'm')).toBe(k);
		expect(cacheKey({ ...req, promptId: 'p.v2' }, 'm')).not.toBe(k);
		expect(cacheKey({ ...req, messages: [{ role: 'user', content: 'hi!' }] }, 'm')).not.toBe(k);
		expect(cacheKey(req, 'other')).not.toBe(k);
	});
});

describe('parseJsonLoose', () => {
	it('strips reasoning and fences', () => {
		expect(parseJsonLoose('<think>hmm {no}</think>\n```json\n{"a": [1]}\n```')).toEqual({ a: [1] });
	});
	it('takes the first object when the model repeats itself', () => {
		const once = '{"answer": "Hi {there}, \\"quoted\\" }"}';
		expect(parseJsonLoose(once + once)).toEqual({ answer: 'Hi {there}, "quoted" }' });
	});
	it('skips a broken object before a good one', () => {
		expect(parseJsonLoose('Sure: {oops} then {"a": 1}')).toEqual({ a: 1 });
	});
	it('throws without an object', () => {
		expect(() => parseJsonLoose('sorry')).toThrow();
	});
});

describe('JSON repair', () => {
	it('accepts raw newlines and tabs inside strings, and trailing commas', () => {
		const text = '{"answer": "line one\nline two", "claims": [{"quote": "if (x)\t{"},]}';
		expect(parseJsonLoose<{ answer: string; claims: { quote: string }[] }>(text)).toEqual({
			answer: 'line one\nline two',
			claims: [{ quote: 'if (x)\t{' }]
		});
	});

	it('recovers the answer from JSON cut off mid-claims', () => {
		const text = '{"answer": "Start with \\"probe\\" functions.", "claims": [{"text": "psm';
		expect(() => parseJsonLoose(text)).toThrow();
		expect(extractJsonString(text, 'answer')).toBe('Start with "probe" functions.');
		expect(extractJsonString('plain prose', 'answer')).toBeNull();
	});
});
