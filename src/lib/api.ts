import { browser } from '$app/environment';

/**
 * fetch() for our /api routes. A 401 means the app or GitHub session is gone (the server has
 * already signed out), so reload into /login instead of showing the error.
 */
export async function apiFetch(
	input: string,
	init?: RequestInit,
	f: typeof globalThis.fetch = fetch
): Promise<Response> {
	const res = await f(input, init);
	if (res.status === 401 && browser) {
		location.assign('/login');
		return new Promise(() => {});
	}
	return res;
}

/** GET JSON; non-2xx throws with the server's message and the status on `err.status`. */
export async function getJson<T>(f: typeof globalThis.fetch, url: string): Promise<T> {
	const res = await apiFetch(url, undefined, f);
	if (!res.ok) {
		const err = new Error((await res.json().catch(() => null))?.message ?? res.statusText);
		throw Object.assign(err, { status: res.status });
	}
	return res.json();
}

/** Streamed load promises can be rejected during SSR; call this from the page to redirect on 401. */
export function redirectOn401(promise: Promise<unknown>) {
	promise.catch((err) => {
		if (browser && err?.status === 401) location.assign('/login');
	});
}
