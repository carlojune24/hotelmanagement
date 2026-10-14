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
	return { next: url.searchParams.get('next') ?? '', logoUrl: logoUrlFor(org?.config), orgName: org?.name ?? 'HR' };
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

		const token = generateSessionToken();
		const session = await createSession(token, user.id);
		setSessionCookie(event, token, session.expiresAt);
		redirect(302, safeNext(next, '/'));
	}
};
