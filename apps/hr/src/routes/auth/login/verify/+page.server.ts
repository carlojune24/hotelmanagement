import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import {
	CODE_MINUTES,
	MAX_SENDS,
	OTP_COOKIE,
	OtpError,
	challengeFor,
	maskEmail,
	resendChallenge,
	verifyChallenge
} from '$lib/server/auth/otp';
import { loginFailed, loginRetryAfter, loginSucceeded, tooManyMessage } from '$lib/server/auth/rate-limit';
import { safeNext } from '$lib/server/auth/redirect';
import { createSession, generateSessionToken, setSessionCookie } from '$lib/server/auth/session';
import { logoUrlFor } from '$lib/server/brand';
import { getOrganization } from '$lib/server/establishments';
import { writeAudit } from '$lib/server/audit';
import { db } from '$lib/server/db/index';
import { users } from '$lib/server/db/schema/index';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, cookies, url }) => {
	if (locals.user) redirect(302, '/');
	const challenge = await challengeFor(cookies.get(OTP_COOKIE));
	// No sign-in waiting for a code (never started, expired, or already used): back to the start.
	if (!challenge) redirect(302, '/auth/login');
	const org = await getOrganization().catch(() => null);
	return {
		email: maskEmail(challenge.email),
		minutes: CODE_MINUTES,
		sendsLeft: Math.max(0, MAX_SENDS - challenge.sends),
		/** The sign-in was kept but the email could not be sent: say so, and a recovery code still works. */
		mailFailed: url.searchParams.get('sent') === '0',
		logoUrl: logoUrlFor(org?.config),
		orgName: org?.name ?? 'HR'
	};
};

const codeForm = z.object({ code: z.string().trim().min(1).max(40) });

export const actions: Actions = {
	verify: async (event) => {
		const token = event.cookies.get(OTP_COOKIE);
		const challenge = await challengeFor(token);
		if (!challenge) redirect(303, '/auth/login?code=expired');

		const parsed = codeForm.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Enter the 6-digit code from your email, or a recovery code.' });

		const ip = event.getClientAddress();
		const wait = loginRetryAfter(ip, challenge.email);
		if (wait) return fail(429, { error: tooManyMessage(wait) });

		const result = await verifyChallenge(token, parsed.data.code);
		if (!result.ok) {
			if (result.reason === 'wrong') {
				loginFailed(ip, challenge.email);
				const n = result.attemptsLeft;
				return fail(400, { error: `That code is not right. ${n} ${n === 1 ? 'try' : 'tries'} left.` });
			}
			event.cookies.delete(OTP_COOKIE, { path: '/' });
			if (result.reason === 'locked') {
				// The four wrong tries before it were already counted; this one only ends the sign-in.
				await writeAudit({
					actor: null,
					action: 'signin_code.locked',
					entityType: 'user',
					entityId: challenge.userId,
					after: { ip }
				});
			}
			redirect(303, `/auth/login?code=${result.reason === 'locked' ? 'locked' : 'expired'}`);
		}

		if (result.recovery) {
			await writeAudit({
				actor: null,
				action: 'signin_code.recovery_used',
				entityType: 'user',
				entityId: result.userId,
				after: { ip }
			});
		}

		// Someone could have been disabled between the password and the code.
		const [user] = await db.select({ status: users.status }).from(users).where(eq(users.id, result.userId)).limit(1);
		event.cookies.delete(OTP_COOKIE, { path: '/' });
		if (user?.status !== 'active') redirect(303, '/auth/login');

		loginSucceeded(ip, challenge.email);
		const sessionToken = generateSessionToken();
		const session = await createSession(sessionToken, result.userId);
		setSessionCookie(event, sessionToken, session.expiresAt);
		redirect(303, safeNext(result.next, '/'));
	},

	resend: async (event) => {
		const token = event.cookies.get(OTP_COOKIE);
		const challenge = await challengeFor(token);
		if (!challenge) redirect(303, '/auth/login?code=expired');
		const ip = event.getClientAddress();
		const wait = loginRetryAfter(ip, challenge.email);
		if (wait) return fail(429, { error: tooManyMessage(wait) });
		const org = await getOrganization();
		try {
			const result = await resendChallenge(token, org.id, org.name);
			if (result.ok) return { info: `A new code is on its way to ${maskEmail(challenge.email)}.` };
			if (result.reason === 'wait') return fail(429, { error: `Wait ${result.seconds} seconds before asking for another code.` });
			if (result.reason === 'limit') return fail(429, { error: 'No more codes can be sent for this sign-in. Sign in again to start over.' });
			redirect(303, '/auth/login?code=expired');
		} catch (e) {
			if (e instanceof OtpError) return fail(503, { error: 'We could not email a new code. Try again in a moment, or ask Main HR.' });
			throw e;
		}
	}
};
