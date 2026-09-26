import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Override, ReviewResult, ReviewStatus, Verdict } from '$lib/review';
import { user } from './auth.schema';

/** Plan §4.4 `LLMCall` + §4.5.4 cache: keyed by the hash of the complete normalized input. */
export const llmCall = sqliteTable('llm_call', {
	hash: text('hash').primaryKey(),
	promptId: text('prompt_id').notNull(),
	model: text('model').notNull(),
	response: text('response').notNull(),
	promptTokens: integer('prompt_tokens').notNull(),
	completionTokens: integer('completion_tokens').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull()
});

/** Tab 4 PR reviews (plan §5, §6.2). The full result is one JSON document. */
export const review = sqliteTable(
	'review',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		repo: text('repo').notNull(),
		prNumber: integer('pr_number').notNull(),
		title: text('title').notNull(),
		status: text('status').$type<ReviewStatus>().notNull().default('queued'),
		/** Human-readable step while running. */
		stage: text('stage'),
		error: text('error'),
		verdict: text('verdict').$type<Verdict>(),
		result: text('result', { mode: 'json' }).$type<ReviewResult>(),
		overrides: text('overrides', { mode: 'json' })
			.$type<Override[]>()
			.notNull()
			.default(sql`'[]'`),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		finishedAt: integer('finished_at', { mode: 'timestamp_ms' })
	},
	(table) => [index('review_userId_idx').on(table.userId)]
);
