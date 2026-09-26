import { setImmediate as nextTurn } from 'node:timers/promises';

/**
 * Cooperative multitasking for CPU-heavy scan work. Scans run inside the web server's process
 * (plan §6), so a long synchronous loop freezes every request, including the progress polls.
 * Call the returned `tick()` inside hot loops: it yields to the event loop once the current
 * slice has run longer than `sliceMs`, and costs nothing otherwise.
 */
export function yielder(sliceMs = 15) {
	let start = performance.now();
	return async function tick(): Promise<void> {
		if (performance.now() - start < sliceMs) return;
		await nextTurn();
		start = performance.now();
	};
}
