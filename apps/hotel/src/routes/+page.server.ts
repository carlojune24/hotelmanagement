import { redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull, min, count } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { amenities, hotelAmenities, hotels, ratePlans, roomTypes } from '$lib/server/db/schema/index';
import { firstHotelSlugForUser } from '$lib/server/auth/login';
import { parseBranding } from '$lib/server/branding';
import { getPlatformBrand } from '$lib/server/platform-brand';
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

	const [brand, rows] = await Promise.all([
		getPlatformBrand(),
		db
			.select({ id: hotels.id, slug: hotels.slug, name: hotels.name, city: hotels.city, config: hotels.config })
			.from(hotels)
			.where(and(eq(hotels.status, 'published'), isNull(hotels.deletedAt)))
			.orderBy(asc(hotels.sortOrder), asc(hotels.name))
	]);
	const ids = rows.map((h) => h.id);
	// Same definitions the storefront uses: lowest active rate plan base price, and its room types.
	const [prices, types, amen] = ids.length
		? await Promise.all([
				db
					.select({ id: ratePlans.hotelId, from: min(ratePlans.basePriceCentavos) })
					.from(ratePlans)
					.where(and(inArray(ratePlans.hotelId, ids), eq(ratePlans.isActive, true)))
					.groupBy(ratePlans.hotelId),
				db
					.select({ id: roomTypes.hotelId, n: count() })
					.from(roomTypes)
					.where(inArray(roomTypes.hotelId, ids))
					.groupBy(roomTypes.hotelId),
				db
					.select({ id: hotelAmenities.hotelId, name: amenities.name })
					.from(hotelAmenities)
					.innerJoin(amenities, eq(amenities.id, hotelAmenities.amenityId))
					.where(inArray(hotelAmenities.hotelId, ids))
					.orderBy(asc(hotelAmenities.sortOrder), asc(amenities.name))
			])
		: [[], [], []];
	const fromOf = new Map(prices.map((p) => [p.id, p.from]));
	const typesOf = new Map(types.map((t) => [t.id, t.n]));
	const amenitiesOf = new Map<string, string[]>();
	for (const a of amen) amenitiesOf.set(a.id, [...(amenitiesOf.get(a.id) ?? []), a.name]);
	return {
		signedIn: false as const,
		logoUrl: brand.logoUrl,
		heroImageUrl: brand.heroImageUrl,
		hotels: rows.map((h) => {
			const b = parseBranding(h.config);
			return {
				slug: h.slug,
				name: h.name,
				city: h.city,
				tagline: b.tagline ?? null,
				about: b.about ?? null,
				address: b.contactAddress ?? null,
				phone: b.contactPhone ?? null,
				email: b.contactEmail ?? null,
				amenities: (amenitiesOf.get(h.id) ?? []).slice(0, 5),
				roomTypes: typesOf.get(h.id) ?? 0,
				fromCentavos: fromOf.get(h.id) ?? null,
				// Hero first, then the gallery; the card's arrows page through these.
				images: [...new Set([b.heroImageUrl, ...(b.galleryImages ?? [])].filter((u): u is string => !!u))],
				accent: b.accentColor ?? null
			};
		})
	};
};
