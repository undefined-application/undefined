// In-process job queue (plan §6). Jobs live in memory only: a server restart drops them,
// and `markInterruptedScans` (hooks.server.ts `init`) fails whatever was left running.

type Job = () => Promise<void>;

const CONCURRENCY = 1;
const pending: Job[] = [];
let running = 0;

export function enqueue(job: Job): void {
	pending.push(job);
	drain();
}

function drain() {
	while (running < CONCURRENCY && pending.length > 0) {
		const job = pending.shift()!;
		running++;
		job()
			.catch((err) => console.error('[jobs] job failed', err))
			.finally(() => {
				running--;
				drain();
			});
	}
}
