import { error } from '@sveltejs/kit';
import { canAt } from '$lib/authz';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const est = locals.establishment;
	// The hook resolves it for any signed-in user with access; a signed-out visitor was already
	// redirected by the (app) layout, so this is only a safety net.
	if (!est) error(404, 'Not found');

	const user = locals.user!;
	const access = locals.access!;
	const can = (cap: string) => user.isSystemAdmin || canAt(access, cap, est.id);

	return {
		establishment: { slug: est.slug, name: est.name, kind: est.kind, timezone: est.timezone },
		tabs: {
			employees: can('employee:read'),
			schedule: can('schedule:*'),
			dtr: can('dtr:*'),
			leave: can('leave:*'),
			settings: can('schedule:*')
		}
	};
};
