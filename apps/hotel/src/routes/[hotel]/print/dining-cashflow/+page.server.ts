import { requireCap } from '$lib/server/auth/rbac';
import { diningCashflowReport } from '$lib/server/dining-cashflow';
import { getBirSettings } from '$lib/server/finance/documents';
import { buildCashflowDoc } from '$lib/dining-report-doc';
import { resolveRange } from '$lib/dining-sales-range';
import { localParts } from '$lib/dining-slots';
import type { PageServerLoad } from './$types';

/** The Dining Cashflow report as a printable sheet: same range as the Cashflow tab, every movement listed. */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotel = locals.hotel!;
	const now = new Date();
	const today = localParts(now, hotel.timezone).date;
	const { from, to } = resolveRange(url, today);

	const [report, bir] = await Promise.all([
		diningCashflowReport(hotel.id, from, to, { movementLimit: null }),
		getBirSettings(hotel.id)
	]);
	const { date, time } = localParts(now, hotel.timezone);

	return {
		doc: buildCashflowDoc(report, { from, to, timezone: hotel.timezone }),
		hotelName: hotel.name,
		hotelTin: bir?.tin ?? null,
		printedAt: `${date} ${time}`,
		preparedBy: locals.user?.name ?? '',
		from,
		to
	};
};
