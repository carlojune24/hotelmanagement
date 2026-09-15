import { redirect } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { hotels, memberships } from '$lib/server/db/schema/index';
import type { PageServerLoad } from './$types';

/**
 * No public landing page — guests reach a hotel directly (its own URL or custom domain,
 * never a platform-wide list, per PRODUCT.md's "mmhotel invisible to guests" positioning)
 * and staff sign in directly. `/` only exists to route a visitor to the right place.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/auth/login');
	if (locals.user.isPlatformAdmin) redirect(302, '/admin');

	const memberHotels = await db
		.select({ slug: hotels.slug })
		.from(memberships)
		.innerJoin(hotels, eq(hotels.id, memberships.hotelId))
		.where(eq(memberships.userId, locals.user.id))
		.orderBy(asc(hotels.name));

	if (memberHotels.length > 0) redirect(302, `/${memberHotels[0]!.slug}/dashboard`);

	// Logged in, but no hotel access and not a platform admin — an incomplete/orphaned
	// account (e.g. every membership was later removed). Nothing to redirect to.
	return {};
};
