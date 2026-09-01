import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from '@oslojs/encoding';
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import { sessions, users } from '$lib/server/db/schema/index';

export const SESSION_COOKIE = 'mm_session';
const DAY = 1000 * 60 * 60 * 24;
const SESSION_TTL = 30 * DAY;
const RENEW_WITHIN = 15 * DAY;

export interface SessionUser {
	id: string;
	email: string;
	name: string;
	isPlatformAdmin: boolean;
}

export function generateSessionToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(20));
	return encodeBase32LowerCaseNoPadding(bytes);
}

function tokenToId(token: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

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
			sessionId: sessions.id,
			expiresAt: sessions.expiresAt,
			userId: users.id,
			email: users.email,
			name: users.name,
			isPlatformAdmin: users.isPlatformAdmin,
			status: users.status
		})
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(eq(sessions.id, id))
		.then((r) => r.at(0));

	if (!row) return null;

	if (Date.now() >= row.expiresAt.getTime()) {
		await db.delete(sessions).where(eq(sessions.id, id));
		return null;
	}
	if (row.status !== 'active') {
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
		user: {
			id: row.userId,
			email: row.email,
			name: row.name,
			isPlatformAdmin: row.isPlatformAdmin
		}
	};
}

export async function invalidateSessionToken(token: string) {
	await db.delete(sessions).where(eq(sessions.id, tokenToId(token)));
}

export async function invalidateAllUserSessions(userId: string) {
	await db.delete(sessions).where(eq(sessions.userId, userId));
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
