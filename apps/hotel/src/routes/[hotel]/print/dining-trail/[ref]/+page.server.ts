import { error } from '@sveltejs/kit';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { buildDiningTrail } from '$lib/server/dining-trail';
import { getBirSettings } from '$lib/server/finance/documents';
import { buildTrailDoc } from '$lib/dining-trail-doc';
import { localParts } from '$lib/dining-slots';
import type { PageServerLoad } from './$types';

/** The dining trail as a printable sheet. IP and browser are printed only for hotel admins. */
export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotel = locals.hotel!;
	const admin = !!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, 'hotel:admin'));
	const [trail, bir] = await Promise.all([buildDiningTrail(hotel.id, params.ref, { admin }), getBirSettings(hotel.id)]);
	if (!trail) error(404, 'No dining order or table reservation has that number.');
	const { date, time } = localParts(new Date(), hotel.timezone);

	return {
		ref: trail.ref,
		doc: buildTrailDoc(trail, { timezone: hotel.timezone }),
		hotelName: hotel.name,
		hotelTin: bir?.tin ?? null,
		printedAt: `${date} ${time}`,
		preparedBy: locals.user?.name ?? ''
	};
};
