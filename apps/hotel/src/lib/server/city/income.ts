import { and, gte, lte, ne, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { cashMovements, hotels } from '$lib/server/db/schema/index';
import {
	REVENUE_CATEGORIES,
	buildIncomeReport,
	monthsBetween,
	resolveRange,
	type IncomeRow
} from '$lib/city/income';

/** The city reports on Manila time — every hotel's own business date is already stored per movement. */
const todayManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

/**
 * Resolves the requested range and builds the income report across all non-archived hotels.
 * Filters mirror `lib/server/finance/reports.ts#revenueBySourceReport` (non-voided, direction `in`,
 * same categories, by `business_date`) plus refunds (`out`/`refund`) shown separately.
 */
export async function incomeForRequest(params: URLSearchParams) {
	const range = resolveRange(
		{ range: params.get('range'), from: params.get('from'), to: params.get('to') },
		todayManila()
	);

	const hotelRows = await db
		.select({ id: hotels.id, name: hotels.name, slug: hotels.slug })
		.from(hotels)
		.where(ne(hotels.status, 'archived'));

	const monthExpr = sql<string>`to_char(${cashMovements.businessDate}, 'YYYY-MM')`;
	const grouped = await db
		.select({
			hotelId: cashMovements.hotelId,
			month: monthExpr,
			category: cashMovements.category,
			direction: cashMovements.direction,
			centavos: sql<number>`coalesce(sum(${cashMovements.amountCentavos}), 0)::bigint`
		})
		.from(cashMovements)
		.where(
			and(
				gte(cashMovements.businessDate, range.from),
				lte(cashMovements.businessDate, range.to),
				sql`${cashMovements.voidedAt} is null`,
				sql`(
					(${cashMovements.direction} = 'in' and ${cashMovements.category} in (${sql.join(
						REVENUE_CATEGORIES.map((c) => sql`${c}`),
						sql`, `
					)}))
					or (${cashMovements.direction} = 'out' and ${cashMovements.category} = 'refund')
				)`
			)
		)
		.groupBy(cashMovements.hotelId, monthExpr, cashMovements.category, cashMovements.direction);

	const rows: IncomeRow[] = grouped.map((r) => ({
		hotelId: r.hotelId,
		month: r.month,
		category: r.category,
		direction: r.direction,
		centavos: Number(r.centavos)
	}));

	return {
		range,
		report: buildIncomeReport(hotelRows, rows, monthsBetween(range.from, range.to))
	};
}
