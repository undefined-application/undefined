import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';

/**
 * GitHub sign-in needs an OAuth app. Without one the app runs in guest mode: no account, one shared
 * local user, public repositories only (anonymous GitHub API and clones).
 */
export const githubAuthEnabled = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);

export const auth = betterAuth({
	baseURL: env.ORIGIN,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	socialProviders: githubAuthEnabled
		? {
				github: {
					clientId: env.GITHUB_CLIENT_ID!,
					clientSecret: env.GITHUB_CLIENT_SECRET!,
					// `repo` is needed to list private repos and read PRs. It also grants write access,
					// which the app never uses without an explicit user click (plan §6.1).
					scope: ['read:user', 'user:email', 'repo']
				}
			}
		: {},
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
