import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { diningItems } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { diningSalesReport } from '$lib/server/dining-orders';
import { getBirSettings } from '$lib/server/finance/documents';
import { buildSalesDoc } from '$lib/dining-report-doc';
import { resolveRange } from '$lib/dining-sales-range';
import { localParts } from '$lib/dining-slots';
import type { PageServerLoad } from './$types';

/** The Dining Sales report as a printable sheet: same range and venue as the Sales tab. */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotel = locals.hotel!;
	const now = new Date();
	const today = localParts(now, hotel.timezone).date;
	const { from, to } = resolveRange(url, today);

	const venueParam = url.searchParams.get('venue');
	const venue =
		venueParam && /^[0-9a-f-]{36}$/i.test(venueParam)
			? await db
					.select({ id: diningItems.id, title: diningItems.title })
					.from(diningItems)
					.where(and(eq(diningItems.id, venueParam), eq(diningItems.hotelId, hotel.id)))
					.limit(1)
					.then((r) => r.at(0) ?? null)
			: null;

	const [report, bir] = await Promise.all([diningSalesReport(hotel.id, from, to, venue?.id ?? null), getBirSettings(hotel.id)]);
	const { date, time } = localParts(now, hotel.timezone);

	return {
		doc: buildSalesDoc(report, { venueLabel: venue?.title ?? 'All venues' }),
		hotelName: hotel.name,
		hotelTin: bir?.tin ?? null,
		printedAt: `${date} ${time}`,
		preparedBy: locals.user?.name ?? '',
		from,
		to
	};
};
