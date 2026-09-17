import { redirect } from '@sveltejs/kit';
import { firstHotelSlugForUser } from '$lib/server/auth/login';
import type { PageServerLoad } from './$types';

/**
 * No public landing page — guests reach a hotel directly (its own URL or custom domain,
 * never a platform-wide list, per PRODUCT.md's "mmhotel invisible to guests" positioning)
 * and staff sign in directly. `/` only exists to route a visitor to the right place.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/auth/login');
	if (locals.user.isPlatformAdmin) redirect(302, '/admin');

	const slug = await firstHotelSlugForUser(locals.user.id);
	if (slug) redirect(302, `/${slug}/management/dashboard`);

	// Logged in, but no hotel access and not a platform admin — an incomplete/orphaned
	// account (e.g. every membership was later removed). Nothing to redirect to.
	return {};
};
