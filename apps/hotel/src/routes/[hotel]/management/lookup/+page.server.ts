import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { auditTrail, normaliseQuery, resolveNumber } from '$lib/server/lookup';
import type { PageServerLoad } from './$types';

/** What may open this page: anyone who can open at least one thing it can lead to. */
const LOOKUP_CAPS = ['booking:read', 'dining:read', 'finance:read', 'folio:read'];

export const load: PageServerLoad = async ({ locals, url }) => {
	const can = (cap: string) =>
		!!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, cap));
	if (!LOOKUP_CAPS.some(can)) requireCap(locals.user, locals.role, 'booking:read');

	const hotel = locals.hotel!;
	const q = normaliseQuery(url.searchParams.get('q'));
	const hits = q ? await resolveNumber(hotel.id, hotel.slug, q, can) : [];
	// The data behind each entry is the audit log's own rule: hotel admins only.
	const canSeeDetails = can('hotel:admin');
	const trail = hits.length
		? await auditTrail(
				hotel.id,
				hits.flatMap((h) => h.refs),
				{ details: canSeeDetails }
			)
		: [];

	return {
		q,
		hits: hits.map(({ refs: _refs, cap: _cap, ...h }) => h),
		trail,
		canSeeDetails
	};
};
