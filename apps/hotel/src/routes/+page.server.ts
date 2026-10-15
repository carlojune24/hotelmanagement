import { redirect } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { firstHotelSlugForUser } from '$lib/server/auth/login';
import { parseBranding } from '$lib/server/branding';
import { getPlatformLogo } from '$lib/server/platform-brand';
import type { PageServerLoad } from './$types';

/**
 * Anonymous visitors get the public landing page listing every published hotel. Signed-in
 * people are still routed straight to where they work (the login flow's default `next` is `/`).
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) {
		if (locals.user.isPlatformAdmin) redirect(302, '/admin');
		const slug = await firstHotelSlugForUser(locals.user.id);
		if (slug) redirect(302, `/${slug}/management/dashboard`);
		// Logged in, but no hotel access and not a platform admin — an incomplete/orphaned
		// account (e.g. every membership was later removed). Nothing to redirect to.
		return { signedIn: true as const };
	}

	const [logoUrl, rows] = await Promise.all([
		getPlatformLogo(),
		db
			.select({ slug: hotels.slug, name: hotels.name, city: hotels.city, config: hotels.config })
			.from(hotels)
			.where(and(eq(hotels.status, 'published'), isNull(hotels.deletedAt)))
			.orderBy(asc(hotels.name))
	]);
	return {
		signedIn: false as const,
		logoUrl,
		hotels: rows.map((h) => {
			const b = parseBranding(h.config);
			return {
				slug: h.slug,
				name: h.name,
				city: h.city,
				tagline: b.tagline ?? null,
				image: b.heroImageUrl ?? b.galleryImages?.[0] ?? null,
				accent: b.accentColor ?? null
			};
		})
	};
};
