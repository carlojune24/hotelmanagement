import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lt, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { emailSettings, loginChallenges, users } from '$lib/server/db/schema/index';
import { getMailer } from '$lib/server/email/mailer';
import { renderSigninCodeEmail } from '$lib/server/email/signin-code';
import { hashOpaqueToken } from '$lib/server/crypto';
import { generateSessionToken } from './session';
import { consumeRecoveryCode } from './recovery';

/**
 * The emailed sign-in code. After a correct password the user has no session yet, only a challenge:
 * a 6-digit code that was emailed to them and that is stored as a hash. The code works once, for
 * 10 minutes and for 5 tries; it can be re-sent at most every 60 seconds and 5 times in all.
 */

export const CODE_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
export const MAX_SENDS = 5;
export const RESEND_SECONDS = 60;
export const OTP_COOKIE = 'mm_hr_otp';

export class OtpError extends Error {}

/** A uniformly random 6-digit code, zero-padded. */
export function generateCode(): string {
	return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Hash of a code, bound to the challenge it was issued for so one code can never serve another. */
export function hashCode(challengeId: string, code: string): string {
	return createHash('sha256').update(`${challengeId}:${code}`).digest('hex');
}

/** What the person typed, tolerant of spaces and a dash ("123 456", "123-456"). */
export function normalizeCode(input: string): string {
	return input.replace(/[\s-]/g, '');
}

export function codeMatches(challengeId: string, storedHash: string, typed: string): boolean {
	const code = normalizeCode(typed);
	if (!/^\d{6}$/.test(code)) return false;
	const a = Buffer.from(hashCode(challengeId, code), 'hex');
	const b = Buffer.from(storedHash, 'hex');
	return a.length === b.length && timingSafeEqual(a, b);
}

/** `carlo.caimen@gmail.com` → `c•••••••••@gmail.com`, so the page says where the code went without exposing the address. */
export function maskEmail(email: string): string {
	const [local = '', domain = ''] = email.split('@');
	return `${local.slice(0, 1)}${'•'.repeat(Math.max(3, Math.min(local.length - 1, 9)))}@${domain}`;
}

/** True when signing in needs the emailed code: Main HR switched it on and a test email arrived. */
export async function signinCodeRequired(organizationId: string): Promise<boolean> {
	const [row] = await db
		.select({ on: emailSettings.signinCodeRequired, ok: emailSettings.lastTestOk })
		.from(emailSettings)
		.where(eq(emailSettings.organizationId, organizationId))
		.limit(1);
	return row?.on === true && row.ok === true;
}

async function emailCode(organizationId: string, orgName: string, to: string, code: string) {
	const mailer = await getMailer(organizationId, orgName);
	if (!mailer) throw new OtpError('No mailbox is set up for sign-in codes.');
	const mail = renderSigninCodeEmail({ orgName, code, minutes: CODE_MINUTES });
	try {
		await mailer.transport.sendMail({ from: mailer.from, replyTo: mailer.replyTo, to, ...mail });
	} catch (e) {
		throw new OtpError(`The code could not be emailed: ${e instanceof Error ? e.message : String(e)}`);
	} finally {
		mailer.transport.close();
	}
}

/** Starts a challenge for a user whose password was right and emails the code. Returns the cookie token. */
export async function startChallenge(input: {
	user: { id: string; email: string };
	next: string | null;
	organizationId: string;
	orgName: string;
}): Promise<{ token: string; emailed: boolean }> {
	const token = generateSessionToken();
	const id = hashOpaqueToken(token);
	const code = generateCode();
	await sweepChallenges();
	// One challenge per user: a newer sign-in replaces an older, unfinished one.
	await db.delete(loginChallenges).where(eq(loginChallenges.userId, input.user.id));
	await db.insert(loginChallenges).values({
		id,
		userId: input.user.id,
		codeHash: hashCode(id, code),
		next: input.next,
		expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000)
	});
	// If the email cannot be sent the sign-in is kept anyway: the person still gets the code screen, where a
	// recovery code works without any email, and "Send a new code" can try the mailbox again.
	let emailed = true;
	try {
		await emailCode(input.organizationId, input.orgName, input.user.email, code);
	} catch (e) {
		if (!(e instanceof OtpError)) throw e;
		emailed = false;
	}
	return { token, emailed };
}

/** The live challenge behind a cookie token, with the address the code went to; null when there is none. */
export async function challengeFor(token: string | undefined) {
	if (!token) return null;
	const id = hashOpaqueToken(token);
	const [row] = await db
		.select({
			id: loginChallenges.id,
			userId: loginChallenges.userId,
			email: users.email,
			next: loginChallenges.next,
			sends: loginChallenges.sends,
			lastSentAt: loginChallenges.lastSentAt,
			expiresAt: loginChallenges.expiresAt
		})
		.from(loginChallenges)
		.innerJoin(users, eq(users.id, loginChallenges.userId))
		.where(and(eq(loginChallenges.id, id), gt(loginChallenges.expiresAt, new Date())))
		.limit(1);
	return row ?? null;
}

export type VerifyResult =
	| { ok: true; userId: string; next: string | null; /** A recovery code stood in for the emailed code. */ recovery: boolean }
	| { ok: false; reason: 'missing' | 'expired' | 'locked' }
	| { ok: false; reason: 'wrong'; attemptsLeft: number };

/** Checks a typed code. Every try is counted before it is compared, so parallel guesses cannot beat the limit. */
export async function verifyChallenge(token: string | undefined, typed: string): Promise<VerifyResult> {
	if (!token) return { ok: false, reason: 'missing' };
	const id = hashOpaqueToken(token);
	const [row] = await db
		.update(loginChallenges)
		.set({ attempts: sql`${loginChallenges.attempts} + 1` })
		.where(and(eq(loginChallenges.id, id), gt(loginChallenges.expiresAt, new Date()), lt(loginChallenges.attempts, MAX_ATTEMPTS)))
		.returning();
	if (!row) {
		const [old] = await db.select().from(loginChallenges).where(eq(loginChallenges.id, id)).limit(1);
		if (!old) return { ok: false, reason: 'missing' };
		await db.delete(loginChallenges).where(eq(loginChallenges.id, id));
		return { ok: false, reason: old.expiresAt <= new Date() ? 'expired' : 'locked' };
	}
	// The emailed code, or one of the user's recovery codes. Either way this try was already counted above.
	const byEmail = codeMatches(id, row.codeHash, typed);
	const byRecovery = !byEmail && (await consumeRecoveryCode(row.userId, typed));
	if (byEmail || byRecovery) {
		await db.delete(loginChallenges).where(eq(loginChallenges.id, id));
		return { ok: true, userId: row.userId, next: row.next, recovery: byRecovery };
	}
	if (row.attempts >= MAX_ATTEMPTS) {
		await db.delete(loginChallenges).where(eq(loginChallenges.id, id));
		return { ok: false, reason: 'locked' };
	}
	return { ok: false, reason: 'wrong', attemptsLeft: MAX_ATTEMPTS - row.attempts };
}

export type ResendResult = { ok: true } | { ok: false; reason: 'missing' | 'limit' } | { ok: false; reason: 'wait'; seconds: number };

/** Emails a fresh code for the same sign-in: a new 10 minutes, a fresh set of tries, never more than 5 codes. */
export async function resendChallenge(
	token: string | undefined,
	organizationId: string,
	orgName: string
): Promise<ResendResult> {
	const live = await challengeFor(token);
	if (!live) return { ok: false, reason: 'missing' };
	if (live.sends >= MAX_SENDS) return { ok: false, reason: 'limit' };
	const waited = (Date.now() - live.lastSentAt.getTime()) / 1000;
	if (waited < RESEND_SECONDS) return { ok: false, reason: 'wait', seconds: Math.ceil(RESEND_SECONDS - waited) };

	const code = generateCode();
	await db
		.update(loginChallenges)
		.set({
			codeHash: hashCode(live.id, code),
			attempts: 0,
			sends: sql`${loginChallenges.sends} + 1`,
			lastSentAt: new Date(),
			expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000)
		})
		.where(eq(loginChallenges.id, live.id));
	await emailCode(organizationId, orgName, live.email, code);
	return { ok: true };
}

/** Removes challenges that expired; called whenever a new one starts so the table stays small. */
export async function sweepChallenges() {
	await db.delete(loginChallenges).where(lte(loginChallenges.expiresAt, new Date()));
}
