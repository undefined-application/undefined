import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { account } from '$lib/server/db/schema';
import { auth } from '$lib/server/auth';
import type { BranchSummary, PullSummary, RepoSummary } from '$lib/github';

const API = 'https://api.github.com';

/**
 * The GitHub token is missing or rejected: end the app session too, so the client's 401 handler
 * lands on a login page that doesn't bounce back. Outside a request (background jobs) just 401.
 */
async function githubSessionExpired(message: string): Promise<never> {
	try {
		await auth.api.signOut({ headers: getRequestEvent().request.headers });
	} catch {
		// No request context, or the session is already gone.
	}
	error(401, message);
}

/** The signed-in user's GitHub OAuth token. OAuth-app tokens don't expire, so no refresh. */
export async function getGithubToken(userId: string): Promise<string> {
	const [row] = await db
		.select({ accessToken: account.accessToken })
		.from(account)
		.where(and(eq(account.userId, userId), eq(account.providerId, 'github')))
		.limit(1);

	if (!row?.accessToken)
		return githubSessionExpired('No GitHub account linked. Sign in with GitHub.');
	return row.accessToken;
}

async function gh(token: string, url: string, accept = 'application/vnd.github+json') {
	const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
		headers: {
			Accept: accept,
			Authorization: `Bearer ${token}`,
			'X-GitHub-Api-Version': '2022-11-28'
		}
	});
	if (res.status === 401) await githubSessionExpired('GitHub sign-in expired. Sign in again.');
	// GitHub answers 404 for private repos the token can't see; 422 for unknown refs.
	if (res.status === 404 || res.status === 422) error(404, `GitHub: not found (${url})`);
	if (!res.ok) error(502, `GitHub ${res.status} on ${url}`);
	return res;
}

const repoPath = (owner: string, repo: string) =>
	`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

/** GET every page of a list endpoint, following the `Link: rel="next"` header. */
async function getAllPages<T>(token: string, path: string): Promise<T[]> {
	const items: T[] = [];
	let url: string | null = path;

	while (url) {
		const res = await gh(token, url);

		items.push(...((await res.json()) as T[]));
		url = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
	}

	return items;
}

interface GithubRepo {
	full_name: string;
	name: string;
	owner: { login: string };
	private: boolean;
	fork: boolean;
	default_branch: string;
	description: string | null;
	pushed_at: string | null;
}

const toRepoSummary = (r: GithubRepo): RepoSummary => ({
	fullName: r.full_name,
	owner: r.owner.login,
	name: r.name,
	private: r.private,
	fork: r.fork,
	defaultBranch: r.default_branch,
	description: r.description,
	pushedAt: r.pushed_at
});

export async function listRepos(token: string): Promise<RepoSummary[]> {
	const repos = await getAllPages<GithubRepo>(
		token,
		'/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member'
	);
	return repos.map(toRepoSummary);
}

/** Any repo the token can read, including public repos the user doesn't own. */
export async function getRepo(token: string, owner: string, repo: string): Promise<RepoSummary> {
	const res = await gh(token, repoPath(owner, repo));
	return toRepoSummary((await res.json()) as GithubRepo);
}

/** Branch, tag or SHA → full commit SHA. */
export async function resolveCommit(
	token: string,
	owner: string,
	repo: string,
	ref: string
): Promise<string> {
	const url = `${repoPath(owner, repo)}/commits/${encodeURIComponent(ref)}`;
	const res = await gh(token, url, 'application/vnd.github.sha');
	return (await res.text()).trim();
}

/** `owner/name` or `https://github.com/owner/name(.git)` → parts, or null if neither. */
export function parseRepo(input: string): { owner: string; name: string } | null {
	const m = input.trim().match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
	return m ? { owner: m[1], name: m[2] } : null;
}

interface GithubBranch {
	name: string;
	commit: { sha: string };
	protected: boolean;
}

export async function listBranches(
	token: string,
	owner: string,
	repo: string
): Promise<BranchSummary[]> {
	const path = `${repoPath(owner, repo)}/branches?per_page=100`;
	const branches = await getAllPages<GithubBranch>(token, path);
	return branches.map((b) => ({ name: b.name, sha: b.commit.sha, protected: b.protected }));
}

interface GithubPull {
	number: number;
	title: string;
	state: 'open' | 'closed';
	merged_at: string | null;
	user: { login: string } | null;
	html_url: string;
	updated_at: string;
	base: { ref: string; sha: string };
	head: { ref: string; sha: string };
}

const toPullSummary = (p: GithubPull): PullSummary => ({
	number: p.number,
	title: p.title,
	state: p.state,
	merged: p.merged_at !== null,
	author: p.user?.login ?? 'ghost',
	url: p.html_url,
	baseRef: p.base.ref,
	headRef: p.head.ref,
	baseSha: p.base.sha,
	headSha: p.head.sha,
	updatedAt: p.updated_at
});

/** One page (most recently updated first): big repos have thousands of closed PRs. */
export async function listPulls(
	token: string,
	owner: string,
	repo: string,
	state: 'open' | 'closed' = 'open'
): Promise<PullSummary[]> {
	const path = `${repoPath(owner, repo)}/pulls?state=${state}&sort=updated&direction=desc&per_page=50`;
	const res = await gh(token, path);
	return ((await res.json()) as GithubPull[]).map(toPullSummary);
}

export async function getPull(
	token: string,
	owner: string,
	repo: string,
	number: number
): Promise<PullSummary> {
	const res = await gh(token, `${repoPath(owner, repo)}/pulls/${number}`);
	return toPullSummary((await res.json()) as GithubPull);
}

/** GitHub login + profile for a commit's author (null when the email isn't linked). */
export async function commitAuthorLogin(
	token: string,
	owner: string,
	repo: string,
	sha: string
): Promise<{ login: string; profileUrl: string } | null> {
	const res = await gh(token, `${repoPath(owner, repo)}/commits/${sha}`);
	const body = (await res.json()) as { author: { login: string; html_url: string } | null };
	return body.author ? { login: body.author.login, profileUrl: body.author.html_url } : null;
}
