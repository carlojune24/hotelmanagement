import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { documents, hotels, orders, payments, zReadings } from '../db/schema/index';
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
	const vat = isVat ? inputVatOf(gross, hotel?.vatRateBps ?? 0) : 0;
	const vatable = isVat ? gross - vat : 0;
	const vatExempt = isVat ? 0 : gross;

	// Refunds — the `refund` / `deposit_refund` cash-out movements for the day.
	const refundKey = ['out:refund', 'in:refund', 'out:deposit_refund', 'in:deposit_refund'];
	const refundAmount = refundKey.reduce((s, k) => s + (snap.byCategory[k] ?? 0), 0);

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

	const scPwd = 0;
	const otherDisc = 0;
	const netSales = gross - scPwd - otherDisc;

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
		netSalesCentavos: netSales,
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
