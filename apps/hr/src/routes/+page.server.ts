import { redirect } from '@sveltejs/kit';
import { roleCan } from '$lib/authz';
import { establishmentScope } from '$lib/server/scope';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/auth/login');
	// A manager or clerk lands on their establishment's dashboard; Main HR on the company list.
	const scope = await establishmentScope(locals.user, locals.access!, null);
	if (scope) redirect(302, `/${scope.current.slug}/dashboard`);
	const mainHr = locals.user.isSystemAdmin || roleCan(locals.access!.orgCaps, 'payroll:*');
	redirect(302, mainHr ? '/dashboard' : '/establishments');
};
