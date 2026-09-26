// The wiki's AI overview for one scan: gathers what summary.ts needs from the stored model and
// counts fresh tokens against the scan. Used by the scan's last stage (warms the cache) and the
// summary route.

import { eq, sql } from 'drizzle-orm';
import type { WikiOverview } from '$lib/model';
import { db } from '$lib/server/db';
import { scanRun } from '$lib/server/db/schema';
import type { Llm } from '$lib/server/llm/core';
import { fileHeads, fences, onboardingPack } from './model';
import { wikiOverview } from './summary';
import type { SnapshotView } from './views';

export async function scanOverview(
	view: SnapshotView,
	scanId: string,
	token: string,
	llm: Llm
): Promise<WikiOverview> {
	const pack = onboardingPack(view);
	const report = await fences(view, token);
	const heads = await fileHeads(
		view,
		pack.readingOrder.map((r) => r.path)
	);
	const { tokens, ...overview } = await wikiOverview(pack, llm, report.fences, heads);
	if (!overview.cached) {
		db.update(scanRun)
			.set({ tokensUsed: sql`${scanRun.tokensUsed} + ${tokens}` })
			.where(eq(scanRun.id, scanId))
			.run();
	}
	return overview;
}
