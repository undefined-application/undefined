import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { yielder } from '$lib/server/jobs/yield';

const exec = promisify(execFile);

export interface GitAuth {
	/**
	 * GitHub OAuth token. Passed via env-scoped git config, never written to disk or argv.
	 * Empty in guest mode: anonymous clone, public repos only.
	 */
	token: string;
}

export interface GitOptions {
	cwd?: string;
	auth?: GitAuth;
	/** Written to stdin (e.g. `fetch --stdin`, `log --stdin`). */
	input?: string;
	/** Extra environment, e.g. `GIT_NO_LAZY_FETCH`. */
	env?: NodeJS.ProcessEnv;
}

/** Run git without a shell; arguments are never interpolated. Returns stdout. */
export async function git(args: string[], opts: GitOptions = {}): Promise<string> {
	const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env, GIT_TERMINAL_PROMPT: '0' };
	if (opts.auth?.token) {
		const basic = Buffer.from(`x-access-token:${opts.auth.token}`).toString('base64');
		env.GIT_CONFIG_COUNT = '1';
		env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraHeader';
		env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`;
	}
	const run = exec('git', args, { cwd: opts.cwd, env, maxBuffer: 512 * 1024 * 1024 });
	run.child.stdin?.end(opts.input ?? '');
	const { stdout } = await run;
	return stdout;
}

/** Blob SHAs from `blobs` the clone doesn't have yet. Never triggers a lazy fetch itself. */
async function missingObjects(dir: string, blobs: string[]): Promise<string[]> {
	if (blobs.length === 0) return [];
	const out = await git(['cat-file', '--batch-check=%(objectname)'], {
		cwd: dir,
		input: blobs.join('\n') + '\n',
		env: { GIT_NO_LAZY_FETCH: '1' }
	});
	return out
		.split('\n')
		.filter((l) => l.endsWith(' missing'))
		.map((l) => l.slice(0, l.indexOf(' ')));
}

/**
 * Make sure a blobless clone has these blobs, fetching the missing ones by SHA in one request
 * per chunk (what git's own lazy fetch does, one object at a time). Returns how many it fetched.
 */
export async function ensureBlobs(dir: string, blobs: Iterable<string>, auth?: GitAuth) {
	const missing = await missingObjects(dir, [...new Set(blobs)]);
	for (let i = 0; i < missing.length; i += 5000) {
		await git(
			[
				'-c',
				'fetch.negotiationAlgorithm=noop',
				'fetch',
				'--no-tags',
				'--no-write-fetch-head',
				'--recurse-submodules=no',
				'--filter=blob:none',
				'--stdin',
				'origin'
			],
			{ cwd: dir, auth, input: missing.slice(i, i + 5000).join('\n') + '\n' }
		);
	}
	return missing.length;
}

/** Read blobs as UTF-8 text in one `cat-file --batch`. Call `ensureBlobs` first. */
export async function readBlobs(
	dir: string,
	blobs: Iterable<string>
): Promise<Map<string, string>> {
	const shas = [...new Set(blobs)];
	const result = new Map<string, string>();
	if (shas.length === 0) return result;
	const run = execFile('git', ['cat-file', '--batch'], {
		cwd: dir,
		encoding: 'buffer',
		maxBuffer: 1024 * 1024 * 1024,
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
	});
	const chunks: Buffer[] = [];
	run.stdout!.on('data', (c: Buffer) => chunks.push(c));
	run.stdin!.end(shas.join('\n') + '\n');
	await new Promise<void>((resolve, reject) => {
		run.on('error', reject);
		run.on('close', (code) =>
			code === 0 ? resolve() : reject(new Error(`cat-file exit ${code}`))
		);
	});
	const out = Buffer.concat(chunks);
	let pos = 0;
	const tick = yielder();
	while (pos < out.length) {
		await tick();
		const nl = out.indexOf(0x0a, pos);
		const [sha, type, size] = out.subarray(pos, nl).toString().split(' ');
		pos = nl + 1;
		if (type === 'missing' || size === undefined) continue;
		const len = Number(size);
		if (type === 'blob') result.set(sha, out.subarray(pos, pos + len).toString('utf8'));
		pos += len + 1;
	}
	return result;
}
