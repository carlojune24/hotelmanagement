import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { cashMovements, expenseCategories, expenses, payments, orders } from '../db/schema/index';
import { getCashPosition } from './cash';
import { arAging } from './receivables';
import { daySnapshot } from './dayclose';

export { toCsv } from './calc';

const REVENUE_CATEGORIES = [
	'room_revenue',
	'hall_revenue',
	'incidental_sale',
	'other_revenue'
] as const;

// ---------------------------------------------------------------------------

export interface DailySalesReport {
	date: string;
	revenueBySource: { source: string; amountCentavos: number }[];
	byMethod: { method: string; count: number; amountCentavos: number }[];
	depositsCentavos: number;
	refundsCentavos: number;
	grossRevenueCentavos: number;
	netCashCentavos: number;
}

export async function dailySalesReport(hotelId: string, date: string): Promise<DailySalesReport> {
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
				sql`${cashMovements.voidedAt} is null`
			)
		);

	const revenueBySource = REVENUE_CATEGORIES.map((source) => ({
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
	const methodMap = new Map<string, { count: number; amountCentavos: number }>();
	for (const p of paymentRows) {
		const cur = methodMap.get(p.method) ?? { count: 0, amountCentavos: 0 };
		cur.count += 1;
		cur.amountCentavos += p.amountCentavos;
		methodMap.set(p.method, cur);
	}

	return {
		date,
		revenueBySource,
		byMethod: [...methodMap.entries()].map(([method, v]) => ({ method, ...v })),
		depositsCentavos,
		refundsCentavos,
		grossRevenueCentavos: snap.grossRevenueCentavos,
		netCashCentavos: snap.netCentavos
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
	to: string
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
				sql`${cashMovements.voidedAt} is null`
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

export async function revenueBySourceReport(hotelId: string, from: string, to: string) {
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
				sql`${cashMovements.category} in ('room_revenue','hall_revenue','incidental_sale','other_revenue','deposit')`
			)
		)
		.groupBy(cashMovements.category);

	const rows = grouped.map((r) => ({
		source: r.category,
		amountCentavos: Number(r.amountCentavos)
	}));
	return { rows, totalCentavos: rows.reduce((s, r) => s + r.amountCentavos, 0) };
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

	const rows = grouped.map((r) => ({
		group: r.group,
		categoryName: r.categoryName,
		count: Number(r.count),
		grossCentavos: Number(r.grossCentavos),
		inputVatCentavos: Number(r.inputVatCentavos)
	}));
	rows.sort((a, b) => b.grossCentavos - a.grossCentavos);
	return {
		rows,
		totalGrossCentavos: rows.reduce((s, r) => s + r.grossCentavos, 0),
		totalInputVatCentavos: rows.reduce((s, r) => s + r.inputVatCentavos, 0)
	};
}

// ---------------------------------------------------------------------------

export async function paymentMethodBreakdown(hotelId: string, from: string, to: string) {
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
