import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { users } from '$lib/server/db/schema/index';
import { verifyPassword } from '$lib/server/auth/password';
import { createSession, generateSessionToken, setSessionCookie } from '$lib/server/auth/session';
import type { Actions, PageServerLoad } from './$types';

const schema = z.object({
	email: z.string().email(),
	password: z.string().min(1),
	next: z.string().optional()
});

function safeNext(next: string | undefined): string {
	return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(302, safeNext(url.searchParams.get('next') ?? undefined));
	return { next: url.searchParams.get('next') ?? '' };
};

export const actions: Actions = {
	default: async (event) => {
		const form = Object.fromEntries(await event.request.formData());
		const parsed = schema.safeParse(form);
		if (!parsed.success) return fail(400, { error: 'Enter a valid email and password.' });

		const { email, password, next } = parsed.data;
		const user = await db
			.select()
			.from(users)
			.where(eq(users.email, email.toLowerCase()))
			.then((r) => r.at(0));

		const ok =
			user?.passwordHash && user.status === 'active'
				? await verifyPassword(user.passwordHash, password)
				: false;

		if (!ok || !user) return fail(400, { error: 'Incorrect email or password.' });

		const token = generateSessionToken();
		const session = await createSession(token, user.id);
		setSessionCookie(event, token, session.expiresAt);

		redirect(302, safeNext(next));
	}
};
