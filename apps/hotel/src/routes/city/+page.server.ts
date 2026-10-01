import { count, eq, ne } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { hotels, rooms, users } from '$lib/server/db/schema/index';
import { cityApplications } from '$lib/server/db/schema/city';
import { incomeForRequest } from '$lib/server/city/income';
import { occupancyForRequest } from '$lib/server/city/occupancy';
import { permitOverview } from '$lib/server/city/permits';
import { ratingsForRequest } from '$lib/server/city/ratings';
import { visitorsForRequest } from '$lib/server/city/visitors';
import { buildAttention, mergeHotelGlance } from '$lib/city/overview';
import type { PageServerLoad } from './$types';

/**
 * The overview reuses each report's own loader for the same period, so every figure here is the one the
 * linked report shows. They run in parallel; the period comes from the URL like on every report page.
 */
export const load: PageServerLoad = async ({ url }) => {
	const params = url.searchParams;
	const [income, visitors, occupancy, ratings, permits, applicationCounts, platform] = await Promise.all([
		incomeForRequest(params),
		visitorsForRequest(params),
		occupancyForRequest(params),
		ratingsForRequest(params),
		permitOverview(),
		db
			.select({ status: cityApplications.status, n: count() })
			.from(cityApplications)
			.groupBy(cityApplications.status),
		(async () => {
			const [h] = await db.select({ n: count() }).from(hotels).where(ne(hotels.status, 'archived'));
			const [p] = await db.select({ n: count() }).from(hotels).where(eq(hotels.status, 'published'));
			const [r] = await db.select({ n: count() }).from(rooms).where(eq(rooms.isActive, true));
			const [u] = await db.select({ n: count() }).from(users);
			return { hotels: h?.n ?? 0, published: p?.n ?? 0, rooms: r?.n ?? 0, users: u?.n ?? 0 };
		})()
	]);

	const appCount = (s: string) => applicationCounts.find((a) => a.status === s)?.n ?? 0;

	return {
		range: income.range,
		today: occupancy.today,
		platform,
		income: { months: income.report.months, totals: income.report.totals, reporting: income.report.reporting },
		visitors: { months: visitors.report.months, totals: visitors.report.totals },
		occupancy: { totals: occupancy.report.totals },
		ratings: { totals: ratings.report.totals },
		glance: mergeHotelGlance({
			income: income.report,
			visitors: visitors.report,
			occupancy: occupancy.report,
			ratings: ratings.report
		}),
		attention: buildAttention({
			pendingApplications: appCount('pending'),
			approvedApplications: appCount('approved'),
			permits: permits.counts,
			reviewsAwaitingApproval: ratings.report.totals.pending
		})
	};
};
