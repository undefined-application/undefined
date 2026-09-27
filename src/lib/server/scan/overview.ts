// The wiki's AI overview for one scan: gathers what summary.ts needs from the stored model, counts
// fresh tokens against the scan and stores the result on it, so it is generated once. Used by the
// scan's last stage and the summary route (when the stage failed or had no model).

import { eq, sql } from 'drizzle-orm';
import type { WikiOverview } from '$lib/model';
import { db } from '$lib/server/db';
import { scanRun } from '$lib/server/db/schema';
import type { Llm } from '$lib/server/llm/core';
import { fileHeads, fences, onboardingPack } from './model';
import { wikiOverview } from './summary';
import type { SnapshotView } from './views';

/** The overview stored on the scan, if one was generated. */
export function storedOverview(scanId: string): WikiOverview | null {
	return (
		db.select({ overview: scanRun.overview }).from(scanRun).where(eq(scanRun.id, scanId)).get()
			?.overview ?? null
	);
}

export async function scanOverview(
	view: SnapshotView,
	scanId: string,
	token: string,
	llm: Llm
): Promise<WikiOverview> {
	const stored = storedOverview(scanId);
	if (stored) return stored;
	const pack = onboardingPack(view);
	const report = await fences(view, token);
	const heads = await fileHeads(
		view,
		pack.readingOrder.map((r) => r.path)
	);
	const { tokens, ...overview } = await wikiOverview(pack, llm, report.fences, heads);
	db.update(scanRun)
		.set({
			overview,
			...(overview.cached ? {} : { tokensUsed: sql`${scanRun.tokensUsed} + ${tokens}` })
		})
		.where(eq(scanRun.id, scanId))
		.run();
	return overview;
}
