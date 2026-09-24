import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** `/{slug}/management` has no page of its own — send staff to the dashboard. Signed-out
 *  visitors then hit the layout's guard on that route and land on the hotel login with
 *  `?next=` pointing back at the dashboard. */
export const load: PageServerLoad = async ({ locals, params }) => {
	// On a hotel's custom domain the slug is implicit (see `+layout.server.ts`).
	const prefix = locals.isCustomDomain ? '' : `/${params.hotel}`;
	redirect(302, `${prefix}/management/dashboard`);
};
