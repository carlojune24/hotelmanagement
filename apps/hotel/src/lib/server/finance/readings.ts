import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index';
import {
	bookings,
	cashMovements,
	documents,
	folios,
	hotels,
	orders,
	paymentAllocations,
	payments,
	scPwdDiscounts,
	zReadings
} from '../db/schema/index';
import { loadOrderLedgers } from '../folio';
import type { ZReading } from '../db/schema/documents';
import type { SessionUser } from '../auth/session';
import { writeAudit } from '../audit';
import { inputVatOf } from './calc';
import { daySnapshot } from './dayclose';
import { getBirSettings } from './documents';

/** The computed figures on an X- or Z-reading — same shape for both; a Z also
 *  carries the counter and grand-total accumulation from its stored row. */
export interface ReadingData {
	businessDate: string;
	invoiceBeginNo: string | null;
	invoiceEndNo: string | null;
	invoiceCount: number;
	orBeginNo: string | null;
	orEndNo: string | null;
	orCount: number;
	grossSalesCentavos: number;
	vatableSalesCentavos: number;
	vatExemptSalesCentavos: number;
	zeroRatedSalesCentavos: number;
	vatCentavos: number;
	scPwdDiscountCentavos: number;
	otherDiscountCentavos: number;
	voidCount: number;
	voidAmountCentavos: number;
	refundCount: number;
	refundAmountCentavos: number;
	netSalesCentavos: number;
	/** VAT taken off SC/PWD sales that day. Information: it is already out of the sales above. */
	scPwdVatRemovedCentavos: number;
	/** Credit owed to SC/PWD guests and not yet refunded. Information only. */
	scPwdCreditOwedCentavos: number;
	/** 1 = original rule, 2 = money kept (received − refunds). See `z_readings.net_method`. */
	netMethod: 1 | 2;
	tenderBreakdown: Record<string, number>;
}

export interface ReadingView extends ReadingData {
	kind: 'x' | 'z';
	hotelName: string;
	hotelTin: string | null;
	isVatRegistered: boolean;
	/** X: projected `prev + net`. Z: the locked stored values. */
	zCounter: number | null;
	prevGrandTotalCentavos: number;
	newGrandTotalCentavos: number;
	generatedAt: string;
	dayClosed: boolean;
}

async function serialSpan(hotelId: string, type: 'invoice' | 'official_receipt', businessDate: string) {
	const rows = await db
		.select({ formattedNo: documents.formattedNo })
		.from(documents)
		.where(
			and(
				eq(documents.hotelId, hotelId),
				eq(documents.type, type),
				eq(documents.status, 'issued'),
				sql`${documents.issuedAt} >= ${businessDate}::date and ${documents.issuedAt} < (${businessDate}::date + 1)`
			)
		)
		.orderBy(asc(documents.serialNo));
	return {
		begin: rows[0]?.formattedNo ?? null,
		end: rows.at(-1)?.formattedNo ?? null,
		count: rows.length
	};
}

/**
 * The part of the day's room/hall receipts that belongs to bookings with an SC/PWD discount, net of
 * refunds paid out on them. Those are VAT-exempt sales. It looks at what each payment paid for:
 * its explicit per-room split, else the folio it was rung on, else (an online payment tied to no
 * room) the share of the order's charges that sit on discounted rooms.
 */
async function scPwdExemptCentavos(hotelId: string, businessDate: string): Promise<number> {
	const moves = await db
		.select({
			direction: cashMovements.direction,
			amountCentavos: cashMovements.amountCentavos,
			paymentId: cashMovements.paymentId
		})
		.from(cashMovements)
		.where(
			and(
				eq(cashMovements.hotelId, hotelId),
				eq(cashMovements.businessDate, businessDate),
				isNull(cashMovements.voidedAt),
				sql`${cashMovements.paymentId} is not null`,
				sql`${cashMovements.category} in ('room_revenue','hall_revenue','deposit','refund','deposit_refund')`
			)
		);
	if (moves.length === 0) return 0;

	const paymentIds = [...new Set(moves.map((m) => m.paymentId!))];
	const payRows = await db
		.select({ id: payments.id, orderId: payments.orderId, folioId: payments.folioId })
		.from(payments)
		.where(inArray(payments.id, paymentIds));
	const orderIds = [...new Set(payRows.map((p) => p.orderId))];

	const claims = await db
		.select({ bookingId: scPwdDiscounts.bookingId, orderId: bookings.orderId })
		.from(scPwdDiscounts)
		.innerJoin(bookings, eq(bookings.id, scPwdDiscounts.bookingId))
		.where(and(inArray(bookings.orderId, orderIds), isNull(scPwdDiscounts.reversedAt)));
	if (claims.length === 0) return 0;
	const claimed = new Set(claims.map((c) => c.bookingId));

	const folioIds = [...new Set(payRows.flatMap((p) => (p.folioId ? [p.folioId] : [])))];
	const [allocs, folioRows, ledgers] = await Promise.all([
		db
			.select({ paymentId: paymentAllocations.paymentId, bookingId: paymentAllocations.bookingId, amount: paymentAllocations.amountCentavos })
			.from(paymentAllocations)
			.where(inArray(paymentAllocations.paymentId, paymentIds)),
		folioIds.length
			? db.select({ id: folios.id, bookingId: folios.bookingId }).from(folios).where(inArray(folios.id, folioIds))
			: Promise.resolve([] as { id: string; bookingId: string | null }[]),
		loadOrderLedgers([...new Set(claims.map((c) => c.orderId))])
	]);
	const payById = new Map(payRows.map((p) => [p.id, p]));
	const bookingOfFolio = new Map(folioRows.map((f) => [f.id, f.bookingId]));
	const allocsBy = new Map<string, typeof allocs>();
	for (const a of allocs) allocsBy.set(a.paymentId, [...(allocsBy.get(a.paymentId) ?? []), a]);

	let exempt = 0;
	for (const m of moves) {
		const pay = payById.get(m.paymentId!);
		if (!pay) continue;
		const sign = m.direction === 'in' ? 1 : -1;
		let share = 0;
		const parts = allocsBy.get(pay.id);
		if (parts && parts.length > 0) {
			const total = parts.reduce((s, a) => s + a.amount, 0);
			const claimedAmt = parts.filter((a) => a.bookingId && claimed.has(a.bookingId)).reduce((s, a) => s + a.amount, 0);
			share = total > 0 ? (m.amountCentavos * claimedAmt) / total : 0;
		} else if (pay.folioId) {
			const b = bookingOfFolio.get(pay.folioId);
			share = b && claimed.has(b) ? m.amountCentavos : 0;
		} else {
			const lines = ledgers.get(pay.orderId)?.lines ?? [];
			const total = lines.reduce((s, l) => s + l.chargesCentavos, 0);
			const claimedC = lines.filter((l) => claimed.has(l.id)).reduce((s, l) => s + l.chargesCentavos, 0);
			share = total > 0 ? (m.amountCentavos * claimedC) / total : 0;
		}
		exempt += sign * Math.round(share);
	}
	return exempt;
}

/**
 * Credit still owed to guests whose SC/PWD discount came after they paid: the negative balance on
 * discounted rooms right now. Information for the cashier; it never changes a sale.
 */
async function scPwdCreditOwedCentavos(hotelId: string): Promise<number> {
	const claims = await db
		.select({ bookingId: scPwdDiscounts.bookingId, orderId: bookings.orderId })
		.from(scPwdDiscounts)
		.innerJoin(bookings, eq(bookings.id, scPwdDiscounts.bookingId))
		.where(
			and(
				eq(scPwdDiscounts.hotelId, hotelId),
				isNull(scPwdDiscounts.reversedAt),
				gte(scPwdDiscounts.appliedAt, sql`now() - interval '120 days'`)
			)
		);
	if (claims.length === 0) return 0;
	const ledgers = await loadOrderLedgers([...new Set(claims.map((c) => c.orderId))]);
	const claimed = new Set(claims.map((c) => c.bookingId));
	let credit = 0;
	for (const l of ledgers.values())
		for (const line of l.lines) if (claimed.has(line.id) && line.balanceCentavos < 0) credit += -line.balanceCentavos;
	return credit;
}

/**
 * The shared X/Z computation for one business date. Cash-basis, on the same
 * `cash_movements` gross the daily-sales report already uses; VAT is extracted
 * from the VAT-inclusive gross for a VAT-registered hotel. No row is written.
 */
export async function computeReadingData(hotelId: string, businessDate: string): Promise<ReadingData> {
	const [hotel] = await db
		.select({ vatRateBps: hotels.vatRateBps })
		.from(hotels)
		.where(eq(hotels.id, hotelId))
		.limit(1);
	const bir = await getBirSettings(hotelId).catch(() => null);
	const isVat = bir?.isVatRegistered ?? false;

	const snap = await daySnapshot(hotelId, businessDate);
	const gross = snap.grossRevenueCentavos;

	// Refunds — the `refund` / `deposit_refund` cash-out movements for the day.
	const refundKey = ['out:refund', 'in:refund', 'out:deposit_refund', 'in:deposit_refund'];
	const refundAmount = refundKey.reduce((s, k) => s + (snap.byCategory[k] ?? 0), 0);

	// Net sales is the money the hotel KEPT: received less refunds paid out. An SC/PWD discount is not
	// taken off again: when it came before payment the guest simply paid less, and when it came after,
	// the credit goes back as a refund, which is already deducted here.
	const netSales = gross - refundAmount;
	// SC/PWD sales are VAT-exempt, so VAT is worked out only on the rest. A hotel that is not VAT
	// registered reports everything as exempt, as before.
	const scPwdExempt = isVat ? await scPwdExemptCentavos(hotelId, businessDate) : 0;
	const vatableGross = isVat ? netSales - scPwdExempt : 0;
	const vat = isVat ? inputVatOf(vatableGross, hotel?.vatRateBps ?? 0) : 0;
	const vatable = isVat ? vatableGross - vat : 0;
	const vatExempt = isVat ? scPwdExempt : netSales;

	// Payments (for tender breakdown + refund/void counts) settled on the day.
	const payRows = await db
		.select({
			method: payments.method,
			amountCentavos: payments.amountCentavos,
			voidedAt: payments.voidedAt,
			purpose: payments.purpose
		})
		.from(payments)
		.innerJoin(orders, eq(orders.id, payments.orderId))
		.where(
			and(
				eq(orders.hotelId, hotelId),
				sql`${payments.paidAt} >= ${businessDate}::date and ${payments.paidAt} < (${businessDate}::date + 1)`
			)
		);

	const tenderBreakdown: Record<string, number> = {};
	let refundCount = 0;
	let voidedPayCount = 0;
	let voidedPayAmount = 0;
	for (const p of payRows) {
		if (p.voidedAt) {
			voidedPayCount += 1;
			voidedPayAmount += Math.abs(p.amountCentavos);
			continue;
		}
		if (p.purpose === 'refund' || p.amountCentavos < 0) refundCount += 1;
		tenderBreakdown[p.method] = (tenderBreakdown[p.method] ?? 0) + p.amountCentavos;
	}

	// Documents cancelled on the day (informational — cancellation is document-only).
	const cancelled = await db
		.select({ snapshot: documents.snapshot })
		.from(documents)
		.where(
			and(
				eq(documents.hotelId, hotelId),
				eq(documents.status, 'cancelled'),
				sql`${documents.cancelledAt} >= ${businessDate}::date and ${documents.cancelledAt} < (${businessDate}::date + 1)`
			)
		);
	const cancelledAmount = cancelled.reduce(
		(s, r) => s + (((r.snapshot as { totals?: { grossCentavos?: number } })?.totals?.grossCentavos ?? 0)),
		0
	);

	const [inv, or] = await Promise.all([
		serialSpan(hotelId, 'invoice', businessDate),
		serialSpan(hotelId, 'official_receipt', businessDate)
	]);

	// Discounts actually applied that day — reversed claims never count, regardless of when
	// they were reversed (same "just don't count it" posture the rest of this file takes for
	// voided/cancelled rows). Same timestamp-range convention as the `cancelled` documents
	// query above: `sc_pwd_discounts` has no stored `businessDate` column of its own.
	const [scPwdRow] = await db
		.select({
			sum: sql<number>`coalesce(sum(${scPwdDiscounts.discountCentavos}), 0)::int`,
			vatRemoved: sql<number>`coalesce(sum(${scPwdDiscounts.vatRemovedCentavos}), 0)::int`
		})
		.from(scPwdDiscounts)
		.where(
			and(
				eq(scPwdDiscounts.hotelId, hotelId),
				isNull(scPwdDiscounts.reversedAt),
				sql`${scPwdDiscounts.appliedAt} >= ${businessDate}::date and ${scPwdDiscounts.appliedAt} < (${businessDate}::date + 1)`
			)
		);
	const scPwd = scPwdRow?.sum ?? 0;
	const scPwdVatRemoved = scPwdRow?.vatRemoved ?? 0;
	const otherDisc = 0;
	const scPwdCreditOwed = await scPwdCreditOwedCentavos(hotelId);

	return {
		businessDate,
		invoiceBeginNo: inv.begin,
		invoiceEndNo: inv.end,
		invoiceCount: inv.count,
		orBeginNo: or.begin,
		orEndNo: or.end,
		orCount: or.count,
		grossSalesCentavos: gross,
		vatableSalesCentavos: vatable,
		vatExemptSalesCentavos: vatExempt,
		zeroRatedSalesCentavos: 0,
		vatCentavos: vat,
		scPwdDiscountCentavos: scPwd,
		otherDiscountCentavos: otherDisc,
		voidCount: voidedPayCount + cancelled.length,
		voidAmountCentavos: voidedPayAmount + cancelledAmount,
		refundCount,
		refundAmountCentavos: refundAmount,
		netSalesCentavos: netSales - otherDisc,
		scPwdVatRemovedCentavos: scPwdVatRemoved,
		scPwdCreditOwedCentavos: scPwdCreditOwed,
		netMethod: 2,
		tenderBreakdown
	};
}

async function hotelIdentity(hotelId: string) {
	const [hotel] = await db
		.select({ name: hotels.name, vatRateBps: hotels.vatRateBps })
		.from(hotels)
		.where(eq(hotels.id, hotelId))
		.limit(1);
	const bir = await getBirSettings(hotelId).catch(() => null);
	return {
		hotelName: hotel?.name ?? 'Hotel',
		hotelTin: bir?.tin ?? null,
		isVatRegistered: bir?.isVatRegistered ?? false
	};
}

async function latestZ(hotelId: string) {
	const [row] = await db
		.select({ zCounter: zReadings.zCounter, newGrandTotal: zReadings.newGrandTotalCentavos })
		.from(zReadings)
		.where(eq(zReadings.hotelId, hotelId))
		.orderBy(desc(zReadings.zCounter))
		.limit(1);
	return row ?? null;
}

/** On-demand interim reading for a business date. Nothing written, no counter consumed. */
export async function getXReading(hotelId: string, businessDate: string): Promise<ReadingView> {
	const [data, id, prev] = await Promise.all([
		computeReadingData(hotelId, businessDate),
		hotelIdentity(hotelId),
		latestZ(hotelId)
	]);
	const prevGrand = prev?.newGrandTotal ?? 0;
	// Day-closed check without importing the whole dayclose status helper.
	return {
		...data,
		...id,
		kind: 'x',
		zCounter: null,
		prevGrandTotalCentavos: prevGrand,
		newGrandTotalCentavos: prevGrand + data.netSalesCentavos,
		generatedAt: new Date().toISOString(),
		dayClosed: false
	};
}

/**
 * Locks the day's sales into a `z_readings` row with the next per-hotel counter
 * and the running grand-total accumulation. Called by `runDayClose`. Idempotent
 * per day-close: re-closing a reopened day issues a fresh Z (BIR keeps every one).
 */
export async function issueZReading(
	hotelId: string,
	businessDate: string,
	dayCloseId: string | null,
	actor: SessionUser | null
): Promise<ZReading> {
	const [data, prev] = await Promise.all([
		computeReadingData(hotelId, businessDate),
		latestZ(hotelId)
	]);
	const zCounter = (prev?.zCounter ?? 0) + 1;
	const prevGrand = prev?.newGrandTotal ?? 0;
	const newGrand = prevGrand + data.netSalesCentavos;

	const [row] = await db
		.insert(zReadings)
		.values({
			hotelId,
			zCounter,
			businessDate,
			dayCloseId,
			invoiceBeginNo: data.invoiceBeginNo,
			invoiceEndNo: data.invoiceEndNo,
			invoiceCount: data.invoiceCount,
			orBeginNo: data.orBeginNo,
			orEndNo: data.orEndNo,
			orCount: data.orCount,
			grossSalesCentavos: data.grossSalesCentavos,
			vatableSalesCentavos: data.vatableSalesCentavos,
			vatExemptSalesCentavos: data.vatExemptSalesCentavos,
			zeroRatedSalesCentavos: data.zeroRatedSalesCentavos,
			vatCentavos: data.vatCentavos,
			scPwdDiscountCentavos: data.scPwdDiscountCentavos,
			otherDiscountCentavos: data.otherDiscountCentavos,
			voidCount: data.voidCount,
			voidAmountCentavos: data.voidAmountCentavos,
			refundCount: data.refundCount,
			refundAmountCentavos: data.refundAmountCentavos,
			netSalesCentavos: data.netSalesCentavos,
			scPwdVatRemovedCentavos: data.scPwdVatRemovedCentavos,
			scPwdCreditOwedCentavos: data.scPwdCreditOwedCentavos,
			netMethod: data.netMethod,
			prevGrandTotalCentavos: prevGrand,
			newGrandTotalCentavos: newGrand,
			tenderBreakdown: data.tenderBreakdown,
			generatedByUserId: actor?.id ?? null
		})
		.returning();

	await writeAudit({
		hotelId,
		actor,
		action: 'bir.issue_z_reading',
		entityType: 'z_reading',
		entityId: row!.id,
		after: { zCounter, businessDate, netSalesCentavos: data.netSalesCentavos }
	});
	return row!;
}

export function zRowToView(row: ZReading, id: Awaited<ReturnType<typeof hotelIdentity>>): ReadingView {
	return {
		businessDate: row.businessDate,
		invoiceBeginNo: row.invoiceBeginNo,
		invoiceEndNo: row.invoiceEndNo,
		invoiceCount: row.invoiceCount,
		orBeginNo: row.orBeginNo,
		orEndNo: row.orEndNo,
		orCount: row.orCount,
		grossSalesCentavos: row.grossSalesCentavos,
		vatableSalesCentavos: row.vatableSalesCentavos,
		vatExemptSalesCentavos: row.vatExemptSalesCentavos,
		zeroRatedSalesCentavos: row.zeroRatedSalesCentavos,
		vatCentavos: row.vatCentavos,
		scPwdDiscountCentavos: row.scPwdDiscountCentavos,
		otherDiscountCentavos: row.otherDiscountCentavos,
		voidCount: row.voidCount,
		voidAmountCentavos: row.voidAmountCentavos,
		refundCount: row.refundCount,
		refundAmountCentavos: row.refundAmountCentavos,
		netSalesCentavos: row.netSalesCentavos,
		scPwdVatRemovedCentavos: row.scPwdVatRemovedCentavos,
		scPwdCreditOwedCentavos: row.scPwdCreditOwedCentavos,
		netMethod: row.netMethod === 2 ? 2 : 1,
		tenderBreakdown: (row.tenderBreakdown as Record<string, number>) ?? {},
		...id,
		kind: 'z',
		zCounter: row.zCounter,
		prevGrandTotalCentavos: row.prevGrandTotalCentavos,
		newGrandTotalCentavos: row.newGrandTotalCentavos,
		generatedAt: row.generatedAt.toISOString(),
		dayClosed: true
	};
}

export async function getZReadingView(hotelId: string, zReadingId: string): Promise<ReadingView | null> {
	const [row] = await db
		.select()
		.from(zReadings)
		.where(and(eq(zReadings.id, zReadingId), eq(zReadings.hotelId, hotelId)))
		.limit(1);
	if (!row) return null;
	return zRowToView(row, await hotelIdentity(hotelId));
}

export async function listZReadings(hotelId: string, limit = 90): Promise<ZReading[]> {
	return db
		.select()
		.from(zReadings)
		.where(eq(zReadings.hotelId, hotelId))
		.orderBy(desc(zReadings.zCounter))
		.limit(limit);
}
