import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { firstHotelSlugForUser, verifyCredentials } from '$lib/server/auth/login';
import {
	loginFailed,
	loginRetryAfter,
	loginSucceeded,
	tooManyMessage
} from '$lib/server/auth/rate-limit';
import { safeNext } from '$lib/server/auth/redirect';
import { createSession, generateSessionToken, setSessionCookie } from '$lib/server/auth/session';
import { getPlatformBrand } from '$lib/server/platform-brand';
import type { Actions, PageServerLoad } from './$types';

const schema = z.object({
	email: z.string().email(),
	password: z.string().min(1),
	next: z.string().optional()
});

/** Sign-in for platform admins; a hotel-staff account is signed in too and sent to its own hotel. */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) {
		if (!locals.user.isPlatformAdmin) {
			const slug = await firstHotelSlugForUser(locals.user.id);
			redirect(302, slug ? `/${slug}/management/dashboard` : '/');
		}
		redirect(302, safeNext(url.searchParams.get('next')));
	}
	const brand = await getPlatformBrand();
	return { next: url.searchParams.get('next') ?? '', logoUrl: brand.logoUrl, photoUrl: brand.heroImageUrl };
};

export const actions: Actions = {
	default: async (event) => {
		const form = Object.fromEntries(await event.request.formData());
		const parsed = schema.safeParse(form);
		if (!parsed.success) return fail(400, { error: 'Enter a valid email and password.' });

		const { email, password, next } = parsed.data;
		const ip = event.getClientAddress();
		const wait = loginRetryAfter(ip, email);
		if (wait) return fail(429, { error: tooManyMessage(wait) });

		const user = await verifyCredentials(email, password);
		if (!user) {
			loginFailed(ip, email);
			return fail(400, { error: 'Incorrect email or password.' });
		}
		loginSucceeded(ip, email);

		const slug = user.isPlatformAdmin ? null : await firstHotelSlugForUser(user.id);
		if (!user.isPlatformAdmin && !slug) {
			return fail(403, { error: 'This account has no platform-admin access.' });
		}

		const token = generateSessionToken();
		const session = await createSession(token, user.id);
		setSessionCookie(event, token, session.expiresAt);

		// Hotel staff are signed in here too, then handed to their hotel's login route, which forwards
		// a signed-in member straight to their home — no second sign-in.
		if (slug) redirect(302, `/${slug}/management/login`);
		redirect(302, safeNext(next));
	}
};
