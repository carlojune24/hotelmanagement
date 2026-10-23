import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { verifyCredentials } from '$lib/server/auth/login';
import {
	loginFailed,
	loginRetryAfter,
	loginSucceeded,
	tooManyMessage
} from '$lib/server/auth/rate-limit';
import { safeNext } from '$lib/server/auth/redirect';
import { createSession, generateSessionToken, setSessionCookie } from '$lib/server/auth/session';
import { CODE_MINUTES, OTP_COOKIE, signinCodeRequired, startChallenge } from '$lib/server/auth/otp';
import { getOrganization } from '$lib/server/establishments';
import { logoUrlFor } from '$lib/server/brand';
import type { Actions, PageServerLoad } from './$types';

const schema = z.object({
	email: z.string().email(),
	password: z.string().min(1),
	next: z.string().optional()
});

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(302, safeNext(url.searchParams.get('next'), '/'));
	const org = await getOrganization().catch(() => null);
	// Why the person was sent back here from the code step, if they were.
	const notice =
		url.searchParams.get('code') === 'expired'
			? 'That code expired. Sign in again to get a new one.'
			: url.searchParams.get('code') === 'locked'
				? 'Too many wrong codes. Sign in again to get a new one.'
				: null;
	return { next: url.searchParams.get('next') ?? '', logoUrl: logoUrlFor(org?.config), orgName: org?.name ?? 'HR', notice };
};

export const actions: Actions = {
	default: async (event) => {
		const parsed = schema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Enter a valid email and password.' });

		const { email, password, next } = parsed.data;
		const ip = event.getClientAddress();
		const wait = loginRetryAfter(ip, email);
		if (wait) return fail(429, { error: tooManyMessage(wait) });

		const user = await verifyCredentials(email, password);
		if (!user) {
			loginFailed(ip, email);
			// Same message for every failure so it never reveals which part was wrong.
			return fail(400, { error: 'Incorrect email or password.' });
		}
		loginSucceeded(ip, email);

		// With the emailed code switched on there is no session yet: email the code and ask for it.
		const org = await getOrganization();
		if (await signinCodeRequired(org.id)) {
			const { token: challenge, emailed } = await startChallenge({
				user: { id: user.id, email: user.email },
				next: safeNext(next, '/'),
				organizationId: org.id,
				orgName: org.name
			});
			event.cookies.set(OTP_COOKIE, challenge, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: !event.url.hostname.includes('localhost'),
				maxAge: CODE_MINUTES * 60
			});
			// When the email could not be sent the code screen says so, and a recovery code still works there.
			redirect(303, emailed ? '/auth/login/verify' : '/auth/login/verify?sent=0');
		}

		const token = generateSessionToken();
		const session = await createSession(token, user.id);
		setSessionCookie(event, token, session.expiresAt);
		redirect(302, safeNext(next, '/'));
	}
};
