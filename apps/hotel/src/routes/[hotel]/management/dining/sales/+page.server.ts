import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { diningItems } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { diningSalesReport } from '$lib/server/dining-orders';
import { localParts } from '$lib/dining-slots';
import { addDays, resolveRange } from '$lib/dining-sales-range';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotelId = locals.hotel!.id;
	const today = localParts(new Date(), locals.hotel!.timezone).date;

	const venues = await db
		.select({ id: diningItems.id, title: diningItems.title })
		.from(diningItems)
		.where(eq(diningItems.hotelId, hotelId))
		.orderBy(asc(diningItems.sortOrder), asc(diningItems.title));
	const venueId = venues.find((v) => v.id === url.searchParams.get('venue'))?.id ?? null;

	const { from, to } = resolveRange(url, today);
	const report = await diningSalesReport(hotelId, from, to, venueId);

	return {
		venues,
		venueId,
		from,
		to,
		today,
		report,
		presets: {
			today: { from: today, to: today },
			week: { from: addDays(today, -6), to: today },
			month: { from: `${today.slice(0, 7)}-01`, to: today }
		}
	};
};
