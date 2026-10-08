import { error } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { diningAreas, diningItems, diningTables } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { recordId } from '$lib/rate-validation';
import { qrSvg, tableQrUrl } from '$lib/server/table-qr';
import type { PageServerLoad } from './$types';

/** Table tents for a venue (optionally one area), four to a page. */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotel = locals.hotel!;
	const venueId = recordId().safeParse(url.searchParams.get('venue'));
	if (!venueId.success) error(404, 'Venue not found.');
	const [venue] = await db
		.select({ id: diningItems.id, title: diningItems.title })
		.from(diningItems)
		.where(and(eq(diningItems.hotelId, hotel.id), eq(diningItems.id, venueId.data)))
		.limit(1);
	if (!venue) error(404, 'Venue not found.');

	const areas = await db
		.select({ id: diningAreas.id, name: diningAreas.name })
		.from(diningAreas)
		.where(and(eq(diningAreas.hotelId, hotel.id), eq(diningAreas.diningItemId, venue.id)))
		.orderBy(asc(diningAreas.sortOrder), asc(diningAreas.name));
	const areaFilter = url.searchParams.get('area');
	const rows = await db
		.select({ id: diningTables.id, name: diningTables.name, areaId: diningTables.areaId, qrToken: diningTables.qrToken })
		.from(diningTables)
		.where(and(eq(diningTables.hotelId, hotel.id), eq(diningTables.diningItemId, venue.id), eq(diningTables.isActive, true)))
		.orderBy(asc(diningTables.name));

	const wanted = rows.filter((t) => (!areaFilter ? true : areaFilter === '_none' ? !t.areaId : t.areaId === areaFilter));
	const tents = await Promise.all(
		wanted.map(async (t) => {
			const link = tableQrUrl({ requestOrigin: url.origin, slug: hotel.slug, token: t.qrToken, customDomain: !!locals.isCustomDomain });
			return { id: t.id, name: t.name, area: areas.find((a) => a.id === t.areaId)?.name ?? null, svg: await qrSvg(link) };
		})
	);
	return { hotelName: hotel.name, venueTitle: venue.title, tents };
};
