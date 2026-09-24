import { redirect } from '@sveltejs/kit';
import { safeNext } from '$lib/server/auth/redirect';
import { deleteSessionCookie, invalidateSessionToken } from '$lib/server/auth/session';
import { listOpenShiftsOpenedBy } from '$lib/server/finance/shifts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	redirect(302, '/');
};

export const actions: Actions = {
	default: async (event) => {
		// A cashier can't walk away from an open drawer: the count is what makes the shift
		// (and any shortage) theirs. The staff shell already intercepts the Sign-out click;
		// this is the backstop for a direct POST or a stale tab.
		if (event.locals.user) {
			const [openShift] = await listOpenShiftsOpenedBy(event.locals.user.id);
			if (openShift) {
				const prefix = event.locals.isCustomDomain ? '' : `/${openShift.hotelSlug}`;
				redirect(303, `${prefix}/management/finance/shifts?logout=blocked`);
			}
		}

		if (event.locals.sessionToken) await invalidateSessionToken(event.locals.sessionToken);
		deleteSessionCookie(event);

		// Hotel staff logging out from `[hotel]/management` land back on that hotel's own
		// login, not `/` — which would otherwise bounce them to the now admin-only
		// `/auth/login` with no way back to their hotel without retyping the URL.
		const formData = await event.request.formData();
		const redirectTo = formData.get('redirectTo');
		redirect(302, typeof redirectTo === 'string' ? safeNext(redirectTo) : '/');
	}
};
