import type { User } from 'better-auth';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';

/** Guest mode (no GitHub OAuth app configured): everyone shares this local user. */
export const GUEST_USER_ID = 'guest';
/** Set by "Continue without an account" on /login. */
export const GUEST_COOKIE = 'undefined_guest';

const GUEST = {
	id: GUEST_USER_ID,
	name: 'Guest',
	email: 'guest@localhost',
	emailVerified: false,
	image: null
};

let guest: User | null = null;

/** The guest user row, created on first use (scans and reviews reference it). */
export function guestUser(): User {
	if (guest) return guest;
	const now = new Date();
	db.insert(user)
		.values({ ...GUEST, createdAt: now, updatedAt: now })
		.onConflictDoNothing()
		.run();
	guest = { ...GUEST, createdAt: now, updatedAt: now };
	return guest;
}
