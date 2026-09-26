// Gonka brokers we have credits on (docs/event/Hackathon-Credits.pdf). Public info only: keys
// live in `.env` as LLM_KEYS_<ID> (comma-separated, one per team member).
// `models` maps the canonical Gonka model id to the broker's own id; a missing entry means the
// broker does not serve that model and the chain skips it. Checked against `/models` 2026-09-26.

const MINIMAX = 'MiniMaxAI/MiniMax-M2.7';
const DEEPSEEK = 'deepseek-ai/DeepSeek-V4-Flash-0731';
const GLM = 'zai-org/GLM-5.3-Flash';

export const STANDARD_MODELS: Record<string, string> = {
	[MINIMAX]: MINIMAX,
	[DEEPSEEK]: DEEPSEEK,
	[GLM]: GLM
};

export interface Broker {
	id: string;
	baseURL: string;
	models: Record<string, string>;
}

export const BROKERS: Broker[] = [
	{
		// First: pricier than the Gonka brokers but far faster. Measured 2026-09-26, uncached: DeepSeek
		// ~3 s a call here vs 21-42 s on the others, and a chat answer is up to 7 calls in a row.
		id: 'hyperfusion',
		baseURL: 'https://api.hyperfusion.io/v1',
		models: { [MINIMAX]: MINIMAX, [DEEPSEEK]: DEEPSEEK }
	},
	{
		id: 'gonka-api',
		baseURL: 'https://hskyauefqcgbvgvxkluj.supabase.co/functions/v1/gonka',
		models: STANDARD_MODELS
	},
	{ id: 'gonkarouter', baseURL: 'https://api.gonkarouter.io/v1', models: STANDARD_MODELS },
	{
		id: 'gonka24',
		baseURL: 'https://api.gonka24.com/v1',
		models: { [MINIMAX]: 'minimax-m2.7', [DEEPSEEK]: 'deepseek-v4-flash-0731' }
	}
];

/** `gonka-api` → `LLM_KEYS_GONKA_API`. */
export const keysVar = (id: string) => `LLM_KEYS_${id.toUpperCase().replace(/-/g, '_')}`;
