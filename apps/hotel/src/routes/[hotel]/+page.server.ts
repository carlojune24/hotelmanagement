import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	// Members and platform admins go to the staff app; everyone else to booking.
	const dest =
		locals.user && (locals.role || locals.user.isPlatformAdmin) ? 'dashboard' : 'book';
	redirect(302, `/${params.hotel}/${dest}`);
};
