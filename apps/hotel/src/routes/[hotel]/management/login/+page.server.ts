import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { verifyCredentials } from '$lib/server/auth/login';
import { safeNext } from '$lib/server/auth/redirect';
import { createSession, generateSessionToken, setSessionCookie } from '$lib/server/auth/session';
import { getMembershipRole } from '$lib/server/tenant';
import type { Actions, PageServerLoad } from './$types';

const schema = z.object({
	email: z.string().email(),
	password: z.string().min(1),
	next: z.string().optional()
});

export const load: PageServerLoad = async ({ locals, url }) => {
	const hotel = locals.hotel;
	if (!hotel) error(404, 'Hotel not found');
	const base = `/${hotel.slug}/management`;

	if (locals.user) redirect(302, safeNext(url.searchParams.get('next'), `${base}/dashboard`));

	return { next: url.searchParams.get('next') ?? '', hotelName: hotel.name };
};

export const actions: Actions = {
	default: async (event) => {
		const hotel = event.locals.hotel;
		if (!hotel) error(404, 'Hotel not found');
		const base = `/${hotel.slug}/management`;

		const form = Object.fromEntries(await event.request.formData());
		const parsed = schema.safeParse(form);
		if (!parsed.success) return fail(400, { error: 'Enter a valid email and password.' });

		const { email, password, next } = parsed.data;
		const user = await verifyCredentials(email, password);
		if (!user) return fail(400, { error: 'Incorrect email or password.' });

		const hasAccess =
			user.isPlatformAdmin || (await getMembershipRole(user.id, hotel.id)) !== null;
		if (!hasAccess) return fail(403, { error: `You don't have access to ${hotel.name}.` });

		const token = generateSessionToken();
		const session = await createSession(token, user.id);
		setSessionCookie(event, token, session.expiresAt);

		redirect(302, safeNext(next, `${base}/dashboard`));
	}
};
