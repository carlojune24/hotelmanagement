import { error, redirect } from '@sveltejs/kit';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { buildDiningTrail, codeForId } from '$lib/server/dining-trail';
import type { PageServerLoad } from './$types';

/**
 * The full trail of one dining tracking number (DN- order or TB- reservation): who did each step,
 * when, and the money and documents. `dining:read` sees who / when / what / amounts; the IP
 * address, browser and before/after data are hotel admins' only (guest IPs are personal data).
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotel = locals.hotel!;
	// An order or reservation id (an older audit row has no tracking number) becomes its number.
	if (/^[0-9a-f-]{36}$/i.test(params.ref)) {
		const code = await codeForId(hotel.id, params.ref);
		if (!code) error(404, 'No dining order or table reservation has that number.');
		redirect(302, `/${hotel.slug}/management/trail/${code}`);
	}
	const admin = !!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, 'hotel:admin'));
	const trail = await buildDiningTrail(hotel.id, params.ref, { admin });
	if (!trail) error(404, 'No dining order or table reservation has that number.');
	return { trail, timezone: hotel.timezone };
};
