import { encodeBase32LowerCaseNoPadding } from '@oslojs/encoding';
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import { sessions, users } from '$lib/server/db/schema/index';
import { hashOpaqueToken } from '$lib/server/crypto';

// Distinct from the hotel app's `mm_session` so two apps on one host/domain family never collide.
export const SESSION_COOKIE = 'mm_hr_session';
const DAY = 1000 * 60 * 60 * 24;
const SESSION_TTL = 30 * DAY;
const RENEW_WITHIN = 15 * DAY;

export interface SessionUser {
	id: string;
	email: string;
	name: string;
	isSystemAdmin: boolean;
}

export function generateSessionToken(): string {
	return encodeBase32LowerCaseNoPadding(crypto.getRandomValues(new Uint8Array(20)));
}

const tokenToId = hashOpaqueToken;

export async function createSession(token: string, userId: string) {
	const id = tokenToId(token);
	const expiresAt = new Date(Date.now() + SESSION_TTL);
	await db.insert(sessions).values({ id, userId, expiresAt });
	return { id, userId, expiresAt };
}

export async function validateSessionToken(
	token: string
): Promise<{ user: SessionUser; expiresAt: Date } | null> {
	const id = tokenToId(token);
	const row = await db
		.select({
			expiresAt: sessions.expiresAt,
			userId: users.id,
			email: users.email,
			name: users.name,
			isSystemAdmin: users.isSystemAdmin,
			status: users.status
		})
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(eq(sessions.id, id))
		.then((r) => r.at(0));

	if (!row) return null;
	if (Date.now() >= row.expiresAt.getTime() || row.status !== 'active') {
		await db.delete(sessions).where(eq(sessions.id, id));
		return null;
	}

	let expiresAt = row.expiresAt;
	if (row.expiresAt.getTime() - Date.now() < RENEW_WITHIN) {
		expiresAt = new Date(Date.now() + SESSION_TTL);
		await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
	}

	return {
		expiresAt,
		user: { id: row.userId, email: row.email, name: row.name, isSystemAdmin: row.isSystemAdmin }
	};
}

export async function invalidateSessionToken(token: string) {
	await db.delete(sessions).where(eq(sessions.id, tokenToId(token)));
}

export function setSessionCookie(event: RequestEvent, token: string, expiresAt: Date) {
	event.cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !event.url.hostname.includes('localhost'),
		expires: expiresAt
	});
}

export function deleteSessionCookie(event: RequestEvent) {
	event.cookies.delete(SESSION_COOKIE, { path: '/' });
}
