import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { acceptInvite, getUsableInvite } from '$lib/server/auth/invite';
import {
	createSession,
	generateSessionToken,
	setSessionCookie
} from '$lib/server/auth/session';
import type { Actions, PageServerLoad } from './$types';

const schema = z
	.object({
		name: z.string().min(1).max(120),
		password: z.string().min(10, 'Use at least 10 characters.'),
		confirm: z.string()
	})
	.refine((v) => v.password === v.confirm, { message: 'Passwords do not match.', path: ['confirm'] });

export const load: PageServerLoad = async ({ params }) => {
	const invite = await getUsableInvite(params.token);
	if (!invite) return { valid: false as const };
	return {
		valid: true as const,
		email: invite.email,
		kind: invite.hotelId ? ('hotel' as const) : ('platform' as const)
	};
};

export const actions: Actions = {
	default: async (event) => {
		const parsed = schema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the form.' });
		}

		const result = await acceptInvite(event.params.token!, {
			name: parsed.data.name,
			password: parsed.data.password
		});
		if ('error' in result) return fail(400, { error: result.error });

		const token = generateSessionToken();
		const session = await createSession(token, result.userId);
		setSessionCookie(event, token, session.expiresAt);
		redirect(302, '/');
	}
};
