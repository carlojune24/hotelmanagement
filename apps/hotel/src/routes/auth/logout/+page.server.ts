import { redirect } from '@sveltejs/kit';
import { deleteSessionCookie, invalidateSessionToken } from '$lib/server/auth/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	redirect(302, '/');
};

export const actions: Actions = {
	default: async (event) => {
		if (event.locals.sessionToken) await invalidateSessionToken(event.locals.sessionToken);
		deleteSessionCookie(event);
		redirect(302, '/');
	}
};
