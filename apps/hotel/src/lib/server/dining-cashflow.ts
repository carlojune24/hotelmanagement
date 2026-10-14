import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from './db/index';
import { cashAccounts, cashMovements, diningOrders, diningPayments, financeSettings } from './db/schema/index';
import { scopeMovementFilter } from './finance/reports';

/** The source label a dining movement is shown under: the way the money arrived. */
export type DiningMoneyMethod = 'cash' | 'card' | 'gcash' | 'maya' | 'paymongo' | 'room_folio' | 'unknown' | string;

export interface DiningCashflowReport {
	totals: { inCentavos: number; refundCentavos: number; netCentavos: number };
	byDay: { date: string; inCentavos: number; refundCentavos: number }[];
	byAccount: { accountId: string; name: string; kind: string; inCentavos: number; refundCentavos: number }[];
	byMethod: { method: DiningMoneyMethod; inCentavos: number; refundCentavos: number }[];
	/** Online money held in Undeposited Funds that has not been paid out to a bank yet. Lifetime, not ranged. */
	awaitingPayout: { undepositedAccountId: string | null; centavos: number };
	/** Paid orders with no live cash movement behind them — they never reached Finance. */
	needsAttention: { orderId: string; code: string; businessDate: string | null; method: string | null; totalCentavos: number }[];
	movements: {
		id: string;
		occurredAt: Date;
		businessDate: string;
		direction: 'in' | 'out';
		amountCentavos: number;
		account: string;
		method: string;
		memo: string | null;
		orderCode: string | null;
	}[];
	payouts: { id: string; businessDate: string; amountCentavos: number; toAccount: string | null; memo: string | null }[];
}

const n = (v: unknown) => Number(v ?? 0);
const isRefund = sql`${cashMovements.direction} = 'out'`;

/** How a dining movement got here, from what it points back to. */
const methodExpr = sql<string>`case
	when ${cashMovements.sourceType} = 'dining_order' then coalesce(${diningOrders.paymentMethod}::text, 'unknown')
	when ${cashMovements.sourceType} = 'dining_payment' then 'paymongo'
	when ${cashMovements.sourceType} = 'dining_refund' then coalesce(${diningPayments.method}::text, 'unknown')
	else 'room_folio' end`;

/**
 * Dining-only cashflow: what was actually received and refunded (from the Finance ledger), where it sits,
 * what is still waiting in Undeposited Funds, and any paid order that never reached Finance. Read-only —
 * it never changes how a movement is recorded.
 */
export async function diningCashflowReport(
	hotelId: string,
	from: string,
	to: string,
	/** `movementLimit: null` lists every movement (print, CSV); the screen shows the latest 100. */
	opts: { movementLimit?: number | null } = {}
): Promise<DiningCashflowReport> {
	const live = and(
		eq(cashMovements.hotelId, hotelId),
		sql`${cashMovements.voidedAt} is null`,
		scopeMovementFilter('dining')
	);
	const inRange = and(live, gte(cashMovements.businessDate, from), lte(cashMovements.businessDate, to));

	const movementQuery = db
		.select({
			id: cashMovements.id,
			occurredAt: cashMovements.occurredAt,
			businessDate: cashMovements.businessDate,
			direction: cashMovements.direction,
			amountCentavos: cashMovements.amountCentavos,
			account: cashAccounts.name,
			method: methodExpr,
			memo: cashMovements.memo,
			orderCode: diningOrders.code
		})
		.from(cashMovements)
		.innerJoin(cashAccounts, eq(cashAccounts.id, cashMovements.cashAccountId))
		.leftJoin(diningOrders, and(eq(cashMovements.sourceType, 'dining_order'), eq(diningOrders.id, cashMovements.sourceId)))
		.leftJoin(diningPayments, and(eq(cashMovements.sourceType, 'dining_refund'), eq(diningPayments.id, cashMovements.sourceId)))
		.where(inRange)
		.orderBy(desc(cashMovements.occurredAt))
		.$dynamic();
	const movementLimit = opts.movementLimit === undefined ? 100 : opts.movementLimit;

	const [byDayRows, byAccountRows, byMethodRows, movementRows, settings] = await Promise.all([
		db
			.select({
				date: cashMovements.businessDate,
				inC: sql<number>`coalesce(sum(case when ${isRefund} then 0 else ${cashMovements.amountCentavos} end), 0)::bigint`,
				outC: sql<number>`coalesce(sum(case when ${isRefund} then ${cashMovements.amountCentavos} else 0 end), 0)::bigint`
			})
			.from(cashMovements)
			.where(inRange)
			.groupBy(cashMovements.businessDate)
			.orderBy(cashMovements.businessDate),
		db
			.select({
				accountId: cashAccounts.id,
				name: cashAccounts.name,
				kind: cashAccounts.kind,
				inC: sql<number>`coalesce(sum(case when ${isRefund} then 0 else ${cashMovements.amountCentavos} end), 0)::bigint`,
				outC: sql<number>`coalesce(sum(case when ${isRefund} then ${cashMovements.amountCentavos} else 0 end), 0)::bigint`
			})
			.from(cashMovements)
			.innerJoin(cashAccounts, eq(cashAccounts.id, cashMovements.cashAccountId))
			.where(inRange)
			.groupBy(cashAccounts.id, cashAccounts.name, cashAccounts.kind),
		db
			.select({
				method: methodExpr,
				inC: sql<number>`coalesce(sum(case when ${isRefund} then 0 else ${cashMovements.amountCentavos} end), 0)::bigint`,
				outC: sql<number>`coalesce(sum(case when ${isRefund} then ${cashMovements.amountCentavos} else 0 end), 0)::bigint`
			})
			.from(cashMovements)
			.leftJoin(diningOrders, and(eq(cashMovements.sourceType, 'dining_order'), eq(diningOrders.id, cashMovements.sourceId)))
			.leftJoin(diningPayments, and(eq(cashMovements.sourceType, 'dining_refund'), eq(diningPayments.id, cashMovements.sourceId)))
			.where(inRange)
			.groupBy(methodExpr),
		movementLimit === null ? movementQuery : movementQuery.limit(movementLimit),
		db
			.select({ undeposited: financeSettings.undepositedAccountId })
			.from(financeSettings)
			.where(eq(financeSettings.hotelId, hotelId))
			.limit(1)
			.then((r) => r.at(0))
	]);

	const byDay = byDayRows.map((r) => ({ date: r.date, inCentavos: n(r.inC), refundCentavos: n(r.outC) }));
	const totalIn = byDay.reduce((s, d) => s + d.inCentavos, 0);
	const totalRefund = byDay.reduce((s, d) => s + d.refundCentavos, 0);

	const undepositedId = settings?.undeposited ?? null;
	let awaiting = 0;
	let payouts: DiningCashflowReport['payouts'] = [];
	if (undepositedId) {
		// Dining money that went into (or refunds that left) Undeposited, less the payouts already moved to a bank.
		const [held] = await db
			.select({
				net: sql<number>`coalesce(sum(case when ${isRefund} then -${cashMovements.amountCentavos} else ${cashMovements.amountCentavos} end), 0)::bigint`
			})
			.from(cashMovements)
			.where(and(live, eq(cashMovements.cashAccountId, undepositedId)));
		const [paidOut] = await db
			.select({ total: sql<number>`coalesce(sum(${cashMovements.amountCentavos}), 0)::bigint` })
			.from(cashMovements)
			.where(
				and(
					eq(cashMovements.hotelId, hotelId),
					sql`${cashMovements.voidedAt} is null`,
					eq(cashMovements.sourceType, 'dining_payout'),
					eq(cashMovements.direction, 'out'),
					eq(cashMovements.cashAccountId, undepositedId)
				)
			);
		awaiting = n(held?.net) - n(paidOut?.total);

		// Each payout's destination is its paired "in" leg.
		const outLegs = await db
			.select({
				id: cashMovements.id,
				businessDate: cashMovements.businessDate,
				amountCentavos: cashMovements.amountCentavos,
				memo: cashMovements.memo,
				group: cashMovements.transferGroupId
			})
			.from(cashMovements)
			.where(
				and(
					eq(cashMovements.hotelId, hotelId),
					sql`${cashMovements.voidedAt} is null`,
					eq(cashMovements.sourceType, 'dining_payout'),
					eq(cashMovements.direction, 'out')
				)
			)
			.orderBy(desc(cashMovements.occurredAt))
			.limit(20);
		const groups = outLegs.map((o) => o.group).filter((g): g is string => !!g);
		const inLegs = groups.length
			? await db
					.select({ group: cashMovements.transferGroupId, name: cashAccounts.name })
					.from(cashMovements)
					.innerJoin(cashAccounts, eq(cashAccounts.id, cashMovements.cashAccountId))
					.where(and(inArray(cashMovements.transferGroupId, groups), eq(cashMovements.direction, 'in')))
			: [];
		payouts = outLegs.map((o) => ({
			id: o.id,
			businessDate: o.businessDate,
			amountCentavos: o.amountCentavos,
			toAccount: inLegs.find((i) => i.group === o.group)?.name ?? null,
			memo: o.memo
		}));
	}

	// A paid order is only real money once a live cash movement stands behind it (cashier or PayMongo).
	const attention = await db
		.select({
			orderId: diningOrders.id,
			code: diningOrders.code,
			businessDate: diningOrders.businessDate,
			method: diningOrders.paymentMethod,
			totalCentavos: diningOrders.totalCentavos
		})
		.from(diningOrders)
		.where(
			and(
				eq(diningOrders.hotelId, hotelId),
				eq(diningOrders.paymentStatus, 'paid'),
				sql`${diningOrders.paymentMethod} is distinct from 'house_use'`,
				gte(diningOrders.businessDate, from),
				lte(diningOrders.businessDate, to),
				sql`not exists (
					select 1 from cash_movements cm
					where cm.voided_at is null
					  and ((cm.source_type = 'dining_order' and cm.source_id = ${diningOrders.id})
					    or (cm.source_type = 'dining_payment' and cm.source_id in (select dp.id from dining_payments dp where dp.order_id = ${diningOrders.id})))
				)`
			)
		)
		.orderBy(desc(diningOrders.paidAt))
		.limit(50);

	return {
		totals: { inCentavos: totalIn, refundCentavos: totalRefund, netCentavos: totalIn - totalRefund },
		byDay,
		byAccount: byAccountRows
			.map((r) => ({ accountId: r.accountId, name: r.name, kind: r.kind, inCentavos: n(r.inC), refundCentavos: n(r.outC) }))
			.sort((a, b) => b.inCentavos - a.inCentavos),
		byMethod: byMethodRows
			.map((r) => ({ method: r.method, inCentavos: n(r.inC), refundCentavos: n(r.outC) }))
			.sort((a, b) => b.inCentavos - a.inCentavos),
		awaitingPayout: { undepositedAccountId: undepositedId, centavos: awaiting },
		needsAttention: attention,
		movements: movementRows.map((m) => ({ ...m, amountCentavos: n(m.amountCentavos) })),
		payouts
	};
}
