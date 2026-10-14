import { and, eq, gte, lte, ne, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import {
	cashMovements,
	diningOrders,
	hotels,
	scPwdDiscounts,
	expenseCategories,
	expenses,
	payments,
	orders
} from '../db/schema/index';
import { getCashPosition } from './cash';
import { arAging } from './receivables';
import { daySnapshot } from './dayclose';

export { toCsv } from './calc';

const REVENUE_CATEGORIES = [
	'room_revenue',
	'hall_revenue',
	'incidental_sale',
	'dining_revenue',
	'other_revenue'
] as const;

/**
 * Which part of the business a report speaks for. Purely a read-side filter on what is already
 * booked: it never changes how a movement is recorded or posted.
 *  - `all`    everything, exactly as the reports always read (the default)
 *  - `hotel`  rooms, function halls, incidentals, other revenue and room deposits
 *  - `dining` restaurant takings (cash movements categorised `dining_revenue`)
 */
export type ReportScope = 'all' | 'hotel' | 'dining';

export const REPORT_SCOPES: { key: ReportScope; label: string }[] = [
	{ key: 'all', label: 'Overall' },
	{ key: 'hotel', label: 'Hotel' },
	{ key: 'dining', label: 'Dining' }
];

export function parseReportScope(v: string | null | undefined): ReportScope {
	return v === 'hotel' || v === 'dining' ? v : 'all';
}

const HOTEL_CATEGORIES = ['room_revenue', 'hall_revenue', 'incidental_sale', 'other_revenue', 'deposit'] as const;

/** The categories a scope's revenue lines are drawn from. */
function scopeRevenueCategories(scope: ReportScope): readonly string[] {
	if (scope === 'dining') return ['dining_revenue'];
	if (scope === 'hotel') return HOTEL_CATEGORIES;
	return REVENUE_CATEGORIES;
}

/**
 * The `cash_movements` rows a scope covers: its revenue categories, plus refunds paid out of it
 * (a dining refund carries `source_type = 'dining_refund'`; any other refund belongs to the hotel).
 * `undefined` for `all`, so the default query is untouched.
 */
export function scopeMovementFilter(scope: ReportScope): SQL | undefined {
	if (scope === 'all') return undefined;
	const isDiningSource = sql`${cashMovements.sourceType} like 'dining%'`;
	if (scope === 'dining') {
		return sql`(${cashMovements.category} = 'dining_revenue' or (${cashMovements.category} = 'refund' and ${isDiningSource}))`;
	}
	const cats = sql.join(HOTEL_CATEGORIES.map((c) => sql`${c}`), sql`, `);
	return sql`(${cashMovements.category} in (${cats}) or (${cashMovements.category} in ('refund', 'deposit_refund') and not ${isDiningSource}))`;
}

// ---------------------------------------------------------------------------

/**
 * Restaurant takings by tender over a range of business dates: orders paid at the till or online
 * (`paid`, not cancelled). A room charge is excluded — it is paid later, through the folio.
 */
async function diningTender(
	hotelId: string,
	from: string,
	to: string
): Promise<{ method: string; count: number; amountCentavos: number }[]> {
	const methodExpr = sql<string>`coalesce(${diningOrders.paymentMethod}::text, 'unknown')`;
	const rows = await db
		.select({
			method: methodExpr,
			count: sql<number>`count(*)::int`,
			amountCentavos: sql<number>`coalesce(sum(${diningOrders.totalCentavos}), 0)::bigint`
		})
		.from(diningOrders)
		.where(
			and(
				eq(diningOrders.hotelId, hotelId),
				eq(diningOrders.paymentStatus, 'paid'),
				ne(diningOrders.status, 'cancelled'),
				gte(diningOrders.businessDate, from),
				lte(diningOrders.businessDate, to)
			)
		)
		.groupBy(methodExpr);
	return rows.map((r) => ({ method: r.method, count: Number(r.count), amountCentavos: Number(r.amountCentavos) }));
}

/**
 * SC/PWD discounts applied in a date range (by the hotel's own calendar day), for information on the
 * reports. They explain why a room was billed less than its price: VAT removed plus the 20%.
 * Never changes cash: the discount is a folio line, not a cash movement.
 */
export async function scPwdInRange(
	hotelId: string,
	from: string,
	to: string
): Promise<{ claims: number; discountCentavos: number; vatRemovedCentavos: number }> {
	const [hotel] = await db.select({ tz: hotels.timezone }).from(hotels).where(eq(hotels.id, hotelId)).limit(1);
	const tz = hotel?.tz ?? 'Asia/Manila';
	const [row] = await db
		.select({
			claims: sql<number>`count(*)::int`,
			discount: sql<number>`coalesce(sum(${scPwdDiscounts.discountCentavos}), 0)::bigint`,
			vat: sql<number>`coalesce(sum(${scPwdDiscounts.vatRemovedCentavos}), 0)::bigint`
		})
		.from(scPwdDiscounts)
		.where(
			and(
				eq(scPwdDiscounts.hotelId, hotelId),
				sql`${scPwdDiscounts.reversedAt} is null`,
				sql`(${scPwdDiscounts.appliedAt} at time zone ${tz})::date between ${from}::date and ${to}::date`
			)
		);
	return {
		claims: Number(row?.claims ?? 0),
		discountCentavos: Number(row?.discount ?? 0),
		vatRemovedCentavos: Number(row?.vat ?? 0)
	};
}

/** Money handed back to guests in a range (cancellation and credit refunds), within a scope. */
export async function refundsInRange(hotelId: string, from: string, to: string, scope: ReportScope = 'all'): Promise<number> {
	const [row] = await db
		.select({ total: sql<number>`coalesce(sum(${cashMovements.amountCentavos}), 0)::bigint` })
		.from(cashMovements)
		.where(
			and(
				eq(cashMovements.hotelId, hotelId),
				eq(cashMovements.direction, 'out'),
				sql`${cashMovements.category} in ('refund', 'deposit_refund')`,
				gte(cashMovements.businessDate, from),
				lte(cashMovements.businessDate, to),
				sql`${cashMovements.voidedAt} is null`,
				scopeMovementFilter(scope)
			)
		);
	return Number(row?.total ?? 0);
}

export interface DailySalesReport {
	date: string;
	revenueBySource: { source: string; amountCentavos: number }[];
	byMethod: { method: string; count: number; amountCentavos: number }[];
	depositsCentavos: number;
	refundsCentavos: number;
	grossRevenueCentavos: number;
	/** Gross received less refunds paid out: the income actually kept. */
	netRevenueCentavos: number;
	/** SC/PWD discounts applied that day (information only); null for the dining scope. */
	scPwd: { claims: number; discountCentavos: number; vatRemovedCentavos: number } | null;
	netCashCentavos: number;
}

export async function dailySalesReport(
	hotelId: string,
	date: string,
	scope: ReportScope = 'all'
): Promise<DailySalesReport> {
	const snap = await daySnapshot(hotelId, date);

	const movementRows = await db
		.select({
			category: cashMovements.category,
			direction: cashMovements.direction,
			amountCentavos: cashMovements.amountCentavos
		})
		.from(cashMovements)
		.where(
			and(
				eq(cashMovements.hotelId, hotelId),
				eq(cashMovements.businessDate, date),
				sql`${cashMovements.voidedAt} is null`,
				scopeMovementFilter(scope)
			)
		);

	const revenueBySource = scopeRevenueCategories(scope)
		.filter((c) => (REVENUE_CATEGORIES as readonly string[]).includes(c))
		.map((source) => ({
		source,
		amountCentavos: movementRows
			.filter((m) => m.direction === 'in' && m.category === source)
			.reduce((s, m) => s + m.amountCentavos, 0)
	}));
	const depositsCentavos = movementRows
		.filter((m) => m.direction === 'in' && m.category === 'deposit')
		.reduce((s, m) => s + m.amountCentavos, 0);
	const refundsCentavos = movementRows
		.filter((m) => m.category === 'refund' || m.category === 'deposit_refund')
		.reduce((s, m) => s + m.amountCentavos, 0);

	// Tender: room/hall payments live in `payments`; restaurant takings in `dining_orders`.
	const methodMap = new Map<string, { count: number; amountCentavos: number }>();
	if (scope === 'dining') {
		for (const m of await diningTender(hotelId, date, date)) {
			methodMap.set(m.method, { count: m.count, amountCentavos: m.amountCentavos });
		}
	} else {
		const paymentRows = await db
			.select({ method: payments.method, amountCentavos: payments.amountCentavos })
			.from(payments)
			.innerJoin(orders, eq(orders.id, payments.orderId))
			.where(
				and(
					eq(orders.hotelId, hotelId),
					eq(payments.status, 'paid'),
					sql`${payments.voidedAt} is null`,
					sql`${payments.paidAt} >= ${date}::date and ${payments.paidAt} < (${date}::date + 1)`
				)
			);
		for (const p of paymentRows) {
			const cur = methodMap.get(p.method) ?? { count: 0, amountCentavos: 0 };
			cur.count += 1;
			cur.amountCentavos += p.amountCentavos;
			methodMap.set(p.method, cur);
		}
	}

	// For a scope the day's totals are rebuilt from that scope's own movements (the day snapshot
	// is the whole business). Net = what the scope took in minus what it refunded out.
	const scoped = scope !== 'all';
	const scopedIn = movementRows.filter((m) => m.direction === 'in').reduce((s, m) => s + m.amountCentavos, 0);
	const scopedOut = movementRows.filter((m) => m.direction === 'out').reduce((s, m) => s + m.amountCentavos, 0);

	const grossRevenueCentavos = scoped ? scopedIn : snap.grossRevenueCentavos;
	// Only refunds PAID OUT reduce income (a refund in this report's rows is always an out-movement).
	const refundsPaidCentavos = movementRows
		.filter((m) => m.direction === 'out' && (m.category === 'refund' || m.category === 'deposit_refund'))
		.reduce((s, m) => s + m.amountCentavos, 0);

	return {
		date,
		revenueBySource,
		byMethod: [...methodMap.entries()].map(([method, v]) => ({ method, ...v })),
		depositsCentavos,
		refundsCentavos,
		grossRevenueCentavos,
		netRevenueCentavos: grossRevenueCentavos - refundsPaidCentavos,
		scPwd: scope === 'dining' ? null : await scPwdInRange(hotelId, date, date),
		netCashCentavos: scoped ? scopedIn - scopedOut : snap.netCentavos
	};
}

// ---------------------------------------------------------------------------

export async function cashPositionReport(hotelId: string, from: string, to: string) {
	return getCashPosition(hotelId, { from, to });
}

// ---------------------------------------------------------------------------

export interface CashflowRow {
	direction: 'in' | 'out';
	category: string;
	count: number;
	amountCentavos: number;
}

export async function cashflowReport(
	hotelId: string,
	from: string,
	to: string,
	scope: ReportScope = 'all'
): Promise<{ rows: CashflowRow[]; totalInCentavos: number; totalOutCentavos: number }> {
	const grouped = await db
		.select({
			direction: cashMovements.direction,
			category: cashMovements.category,
			count: sql<number>`count(*)::int`,
			amountCentavos: sql<number>`coalesce(sum(${cashMovements.amountCentavos}), 0)::bigint`
		})
		.from(cashMovements)
		.where(
			and(
				eq(cashMovements.hotelId, hotelId),
				gte(cashMovements.businessDate, from),
				lte(cashMovements.businessDate, to),
				sql`${cashMovements.voidedAt} is null`,
				scopeMovementFilter(scope)
			)
		)
		.groupBy(cashMovements.direction, cashMovements.category);

	const rows: CashflowRow[] = grouped.map((r) => ({
		direction: r.direction,
		category: r.category,
		count: Number(r.count),
		amountCentavos: Number(r.amountCentavos)
	}));
	rows.sort((a, b) =>
		a.direction === b.direction
			? b.amountCentavos - a.amountCentavos
			: a.direction === 'in'
				? -1
				: 1
	);

	return {
		rows,
		totalInCentavos: rows
			.filter((r) => r.direction === 'in')
			.reduce((s, r) => s + r.amountCentavos, 0),
		totalOutCentavos: rows
			.filter((r) => r.direction === 'out')
			.reduce((s, r) => s + r.amountCentavos, 0)
	};
}

// ---------------------------------------------------------------------------

/** Per-business-date cash in / out for a range — the series behind the dashboard's
 *  daily net-cash chart. Dates with no movement are omitted; the caller fills gaps. */
export async function dailyCashflowReport(
	hotelId: string,
	from: string,
	to: string
): Promise<{ date: string; inCentavos: number; outCentavos: number }[]> {
	const grouped = await db
		.select({
			date: cashMovements.businessDate,
			direction: cashMovements.direction,
			amountCentavos: sql<number>`coalesce(sum(${cashMovements.amountCentavos}), 0)::bigint`
		})
		.from(cashMovements)
		.where(
			and(
				eq(cashMovements.hotelId, hotelId),
				gte(cashMovements.businessDate, from),
				lte(cashMovements.businessDate, to),
				sql`${cashMovements.voidedAt} is null`
			)
		)
		.groupBy(cashMovements.businessDate, cashMovements.direction);

	const byDate = new Map<string, { inCentavos: number; outCentavos: number }>();
	for (const r of grouped) {
		const e = byDate.get(r.date) ?? { inCentavos: 0, outCentavos: 0 };
		if (r.direction === 'in') e.inCentavos += Number(r.amountCentavos);
		else e.outCentavos += Number(r.amountCentavos);
		byDate.set(r.date, e);
	}
	return [...byDate.entries()]
		.map(([date, v]) => ({ date, ...v }))
		.sort((a, b) => a.date.localeCompare(b.date));
}

export async function revenueBySourceReport(
	hotelId: string,
	from: string,
	to: string,
	scope: ReportScope = 'all'
) {
	const grouped = await db
		.select({
			category: cashMovements.category,
			amountCentavos: sql<number>`coalesce(sum(${cashMovements.amountCentavos}), 0)::bigint`
		})
		.from(cashMovements)
		.where(
			and(
				eq(cashMovements.hotelId, hotelId),
				eq(cashMovements.direction, 'in'),
				gte(cashMovements.businessDate, from),
				lte(cashMovements.businessDate, to),
				sql`${cashMovements.voidedAt} is null`,
				sql`${cashMovements.category} in ('room_revenue','hall_revenue','incidental_sale','dining_revenue','other_revenue','deposit')`,
				// Revenue lines only: a scope's refunds are not a "source".
				scope === 'all'
					? undefined
					: sql`${cashMovements.category} in (${sql.join(
							scopeRevenueCategories(scope).map((c) => sql`${c}`),
							sql`, `
						)})`
			)
		)
		.groupBy(cashMovements.category);

	const rows = grouped.map((r) => ({
		source: r.category,
		amountCentavos: Number(r.amountCentavos)
	}));
	const totalCentavos = rows.reduce((s, r) => s + r.amountCentavos, 0);
	const refundsCentavos = await refundsInRange(hotelId, from, to, scope);
	return {
		rows,
		/** Gross received. */
		totalCentavos,
		refundsCentavos,
		/** Gross received less refunds paid out: the income actually kept. */
		netCentavos: totalCentavos - refundsCentavos
	};
}

// ---------------------------------------------------------------------------

export async function expenseReport(hotelId: string, from: string, to: string) {
	const grouped = await db
		.select({
			group: expenseCategories.group,
			categoryName: expenseCategories.name,
			count: sql<number>`count(*)::int`,
			grossCentavos: sql<number>`coalesce(sum(${expenses.grossCentavos}), 0)::bigint`,
			inputVatCentavos: sql<number>`coalesce(sum(${expenses.inputVatCentavos}), 0)::bigint`
		})
		.from(expenses)
		.innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
		.where(
			and(
				eq(expenses.hotelId, hotelId),
				gte(expenses.expenseDate, from),
				lte(expenses.expenseDate, to),
				sql`${expenses.status} <> 'void'`,
				sql`${expenses.deletedAt} is null`
			)
		)
		.groupBy(expenseCategories.group, expenseCategories.name);

	const rows: {
		group: string;
		categoryName: string;
		count: number;
		grossCentavos: number;
		inputVatCentavos: number;
	}[] = grouped.map((r) => ({
		group: r.group,
		categoryName: r.categoryName,
		count: Number(r.count),
		grossCentavos: Number(r.grossCentavos),
		inputVatCentavos: Number(r.inputVatCentavos)
	}));

	// Cash that left a drawer/account as an "expense" without a structured
	// `expenses` row behind it — a shift payout ("paid to / paid for") or a manual
	// cash-out. `sourceType = 'expense'` movements are the payment leg of a real
	// expense row (already counted above), so they're excluded here to avoid a
	// double count. No vendor / category / input VAT on these — that's what
	// bridging the payout dialog to an expense record (a follow-up) would add.
	const [payout] = await db
		.select({
			count: sql<number>`count(*)::int`,
			grossCentavos: sql<number>`coalesce(sum(${cashMovements.amountCentavos}), 0)::bigint`
		})
		.from(cashMovements)
		.where(
			and(
				eq(cashMovements.hotelId, hotelId),
				eq(cashMovements.direction, 'out'),
				eq(cashMovements.category, 'expense'),
				sql`${cashMovements.sourceType} <> 'expense'`,
				sql`${cashMovements.voidedAt} is null`,
				gte(cashMovements.businessDate, from),
				lte(cashMovements.businessDate, to)
			)
		);
	const payoutGross = Number(payout?.grossCentavos ?? 0);
	const payoutCount = Number(payout?.count ?? 0);
	if (payoutCount > 0) {
		rows.push({
			group: 'Cash payouts',
			categoryName: 'Drawer / manual (uncategorised)',
			count: payoutCount,
			grossCentavos: payoutGross,
			inputVatCentavos: 0
		});
	}

	rows.sort((a, b) => b.grossCentavos - a.grossCentavos);
	return {
		rows,
		totalGrossCentavos: rows.reduce((s, r) => s + r.grossCentavos, 0),
		totalInputVatCentavos: rows.reduce((s, r) => s + r.inputVatCentavos, 0),
		uncategorisedPayoutCentavos: payoutGross
	};
}

// ---------------------------------------------------------------------------

export async function paymentMethodBreakdown(
	hotelId: string,
	from: string,
	to: string,
	scope: ReportScope = 'all'
) {
	if (scope === 'dining') {
		const rows = await diningTender(hotelId, from, to);
		return { rows, totalCentavos: rows.reduce((s, r) => s + r.amountCentavos, 0) };
	}
	const rows = await db
		.select({
			method: payments.method,
			count: sql<number>`count(*)::int`,
			amountCentavos: sql<number>`coalesce(sum(${payments.amountCentavos}), 0)::bigint`
		})
		.from(payments)
		.innerJoin(orders, eq(orders.id, payments.orderId))
		.where(
			and(
				eq(orders.hotelId, hotelId),
				eq(payments.status, 'paid'),
				sql`${payments.voidedAt} is null`,
				sql`${payments.paidAt} >= ${from}::date and ${payments.paidAt} < (${to}::date + 1)`
			)
		)
		.groupBy(payments.method);

	const out = rows.map((r) => ({
		method: r.method,
		count: Number(r.count),
		amountCentavos: Number(r.amountCentavos)
	}));
	return { rows: out, totalCentavos: out.reduce((s, r) => s + r.amountCentavos, 0) };
}

// ---------------------------------------------------------------------------

export async function arAgingReport(hotelId: string, asOf: string) {
	return arAging(hotelId, asOf);
}
