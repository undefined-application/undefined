import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { git, type GitAuth } from './git';
import { ANALYSIS_CONFIG } from './snapshot';

/**
 * Stage 0a: make sure `commitSha` is present in a bare, blobless clone at `dir`.
 * Clones on first use, fetches into the existing clone afterwards. History is kept (plan §4.2).
 */
export async function ensureCommit(opts: {
	url: string;
	dir: string;
	commitSha: string;
	auth?: GitAuth;
}): Promise<void> {
	const { url, dir, commitSha, auth } = opts;
	const filter = `--filter=${ANALYSIS_CONFIG.cloneFilter}`;

	if (!existsSync(dir)) {
		await mkdir(dirname(dir), { recursive: true });
		await git(['clone', '--bare', filter, url, dir], { auth });
	}

	const hasCommit = () =>
		git(['cat-file', '-e', `${commitSha}^{commit}`], { cwd: dir }).then(
			() => true,
			() => false
		);

	if (await hasCommit()) return;
	await git(['fetch', filter, 'origin', '+refs/heads/*:refs/heads/*'], { cwd: dir, auth });
	if (await hasCommit()) return;
	// Commit not on any branch tip's history (e.g. a PR head). GitHub allows fetching by SHA.
	await git(['fetch', filter, 'origin', commitSha], { cwd: dir, auth });
	if (!(await hasCommit())) throw new Error(`Commit ${commitSha} not found in ${url}`);
}

/**
 * A PR's head commit. Fork PRs' commits aren't on any branch of the base repo, but GitHub
 * publishes them under `refs/pull/<n>/head`.
 */
export async function ensurePullHead(opts: {
	dir: string;
	number: number;
	headSha: string;
	auth?: GitAuth;
}): Promise<void> {
	const { dir, number, headSha, auth } = opts;
	const has = () =>
		git(['cat-file', '-e', `${headSha}^{commit}`], { cwd: dir }).then(
			() => true,
			() => false
		);
	if (await has()) return;
	const filter = `--filter=${ANALYSIS_CONFIG.cloneFilter}`;
	await git(['fetch', filter, 'origin', `+refs/pull/${number}/head:refs/pull/${number}/head`], {
		cwd: dir,
		auth
	});
	if (!(await has())) throw new Error(`PR #${number} head ${headSha} not found`);
}

/** Best common ancestor: what GitHub's three-dot PR diff is computed against. */
export async function mergeBase(dir: string, a: string, b: string): Promise<string> {
	return (await git(['merge-base', a, b], { cwd: dir })).trim();
}

export interface TreeEntry {
	path: string;
	blobSha: string;
}

/** Parse `git ls-tree -r -z` output. Skips submodules (type `commit`) and symlinks. */
export function parseLsTree(out: string): TreeEntry[] {
	const entries: TreeEntry[] = [];
	for (const record of out.split('\0')) {
		if (!record) continue;
		const tab = record.indexOf('\t');
		const [mode, type, sha] = record.slice(0, tab).split(' ');
		if (type !== 'blob' || mode === '120000') continue;
		entries.push({ path: record.slice(tab + 1), blobSha: sha });
	}
	return entries;
}

/**
 * Stage 0b: file list at `commitSha`. Reads tree objects only; blobs stay unfetched.
 * No `-l`: sizes need the blobs, which a blobless clone would fetch one by one (minutes on ArduPilot).
 */
export async function listTree(dir: string, commitSha: string): Promise<TreeEntry[]> {
	return parseLsTree(await git(['ls-tree', '-r', '-z', commitSha], { cwd: dir }));
}

const LANGUAGES: Record<string, string> = {
	c: 'c',
	h: 'c-header',
	cc: 'cpp',
	cpp: 'cpp',
	cxx: 'cpp',
	hh: 'cpp-header',
	hpp: 'cpp-header',
	hxx: 'cpp-header',
	s: 'asm',
	S: 'asm',
	asm: 'asm',
	py: 'python',
	cmake: 'cmake',
	mk: 'make',
	ld: 'linker-script',
	md: 'markdown',
	txt: 'text',
	json: 'json',
	xml: 'xml',
	yaml: 'yaml',
	yml: 'yaml',
	sh: 'shell'
};

export function languageOf(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	if (name === 'CMakeLists.txt') return 'cmake';
	if (name === 'Makefile' || name === 'makefile') return 'make';
	const dot = name.lastIndexOf('.');
	return (dot > 0 && LANGUAGES[name.slice(dot + 1)]) || 'other';
}

/** True if `path` is `scope` itself or inside it. Empty scope = whole repo. */
export const inScope = (path: string, scope: string) =>
	!scope || path === scope || path.startsWith(`${scope}/`);
