import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { bookings, diningOrders, documents, hotels, scPwdDiscounts, users } from '../db/schema/index';
import { computeDiningDiscount } from '../../dining-discount';
import type { ReportScope } from './reports';

/**
 * Every Senior Citizen / PWD discount given in a period, hotel and dining, one trail row each, and
 * totals per day / week / month built from those same rows (so the two always agree).
 *  - Hotel: `sc_pwd_discounts` (one claim per room booking), dated by `applied_at` in the hotel's
 *    timezone like `scPwdInRange`. Reversed claims are listed but never counted.
 *  - Dining: paid `dining_orders` with `discount_kind = 'sc_pwd'`, dated by `business_date` (the day
 *    the money landed). A voided payment clears the discount, so it is simply not here.
 */
export type ScPwdGroup = 'day' | 'week' | 'month';
export const parseScPwdGroup = (v: string | null | undefined): ScPwdGroup => (v === 'week' || v === 'month' ? v : 'day');

export interface ScPwdTrailRow {
	date: string;
	side: 'hotel' | 'dining';
	ref: string;
	/** The record behind it, relative to `/{slug}/management`. */
	href: string;
	guests: { type: 'senior_citizen' | 'pwd' | null; name: string; idNumber: string }[];
	baseCentavos: number;
	vatRemovedCentavos: number;
	discountCentavos: number;
	receipts: string[];
	givenBy: string | null;
	/** Set on a hotel claim that was undone; such a row counts in no total. */
	reversedOn: string | null;
	/** A dining discount given after the bill was paid: what was handed back. Null when given at payment. */
	refundedAfterPaymentCentavos: number | null;
}

export interface ScPwdPeriodRow {
	period: string;
	hotel: number;
	dining: number;
	senior: number;
	pwd: number;
	discountCentavos: number;
	vatRemovedCentavos: number;
}

export interface ScPwdReport {
	trail: ScPwdTrailRow[];
	periods: ScPwdPeriodRow[];
	/** Guests discounted (a dining bill can carry several), excluding reversed claims. */
	totals: Omit<ScPwdPeriodRow, 'period'>;
}

/** Monday of the ISO week, or `YYYY-MM`, or the date itself. */
export function periodOf(date: string, group: ScPwdGroup): string {
	if (group === 'month') return date.slice(0, 7);
	if (group === 'day') return date;
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
	return d.toISOString().slice(0, 10);
}

/** Pure: totals per period and overall from the trail rows. */
export function summarizeScPwd(trail: ScPwdTrailRow[], group: ScPwdGroup): Pick<ScPwdReport, 'periods' | 'totals'> {
	const empty = (): Omit<ScPwdPeriodRow, 'period'> => ({ hotel: 0, dining: 0, senior: 0, pwd: 0, discountCentavos: 0, vatRemovedCentavos: 0 });
	const totals = empty();
	const byPeriod = new Map<string, Omit<ScPwdPeriodRow, 'period'>>();
	for (const r of trail) {
		if (r.reversedOn) continue;
		const p = byPeriod.get(periodOf(r.date, group)) ?? empty();
		byPeriod.set(periodOf(r.date, group), p);
		for (const t of [p, totals]) {
			t[r.side] += r.guests.length;
			t.senior += r.guests.filter((g) => g.type === 'senior_citizen').length;
			t.pwd += r.guests.filter((g) => g.type === 'pwd').length;
			t.discountCentavos += r.discountCentavos;
			t.vatRemovedCentavos += r.vatRemovedCentavos;
		}
	}
	const periods = [...byPeriod.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, v]) => ({ period, ...v }));
	return { periods, totals };
}

async function receiptsBy(column: typeof documents.orderId | typeof documents.diningOrderId, ids: string[]) {
	const out = new Map<string, string[]>();
	if (ids.length === 0) return out;
	const rows = await db
		.select({ key: column, no: documents.formattedNo })
		.from(documents)
		.where(and(inArray(column, ids), eq(documents.status, 'issued')))
		.orderBy(asc(documents.issuedAt));
	for (const r of rows) if (r.key) out.set(r.key, [...(out.get(r.key) ?? []), r.no]);
	return out;
}

async function hotelRows(hotelId: string, from: string, to: string): Promise<ScPwdTrailRow[]> {
	const [h] = await db.select({ tz: hotels.timezone }).from(hotels).where(eq(hotels.id, hotelId)).limit(1);
	const tz = h?.tz ?? 'Asia/Manila';
	const day = sql<string>`((${scPwdDiscounts.appliedAt} at time zone ${tz})::date)::text`;
	const rows = await db
		.select({
			date: day,
			bookingId: scPwdDiscounts.bookingId,
			orderId: bookings.orderId,
			type: scPwdDiscounts.claimantType,
			name: scPwdDiscounts.claimantName,
			idNumber: scPwdDiscounts.idNumber,
			base: scPwdDiscounts.baseAmountCentavos,
			vat: scPwdDiscounts.vatRemovedCentavos,
			discount: scPwdDiscounts.discountCentavos,
			by: users.name,
			reversedOn: sql<string | null>`((${scPwdDiscounts.reversedAt} at time zone ${tz})::date)::text`
		})
		.from(scPwdDiscounts)
		.innerJoin(bookings, eq(bookings.id, scPwdDiscounts.bookingId))
		.leftJoin(users, eq(users.id, scPwdDiscounts.appliedByUserId))
		.where(and(eq(scPwdDiscounts.hotelId, hotelId), sql`${day}::date between ${from}::date and ${to}::date`))
		.orderBy(asc(scPwdDiscounts.appliedAt));
	const receipts = await receiptsBy(documents.orderId, [...new Set(rows.map((r) => r.orderId))]);
	return rows.map((r) => ({
		date: r.date,
		side: 'hotel',
		ref: r.orderId.slice(0, 8).toUpperCase(),
		href: `reservations/room/${r.bookingId}`,
		guests: [{ type: r.type, name: r.name, idNumber: r.idNumber }],
		baseCentavos: r.base,
		vatRemovedCentavos: r.vat,
		discountCentavos: r.discount,
		receipts: receipts.get(r.orderId) ?? [],
		givenBy: r.by,
		reversedOn: r.reversedOn,
		refundedAfterPaymentCentavos: null
	}));
}

async function diningRows(hotelId: string, from: string, to: string): Promise<ScPwdTrailRow[]> {
	// The day the discount was given: the payment day, or later when it came after payment (and its refund).
	const day = sql<string>`coalesce(${diningOrders.discountBusinessDate}, ${diningOrders.businessDate})::text`;
	const rows = await db
		.select({
			id: diningOrders.id,
			code: diningOrders.code,
			date: day,
			after: diningOrders.discountBusinessDate,
			total: diningOrders.totalCentavos,
			vatBefore: diningOrders.discountVatBeforeCentavos,
			bps: diningOrders.discountBps,
			discount: diningOrders.discountCentavos,
			vat: diningOrders.discountVatRemovedCentavos,
			claimants: diningOrders.discountClaimants,
			diners: diningOrders.discountDiners,
			by: users.name
		})
		.from(diningOrders)
		.leftJoin(users, eq(users.id, diningOrders.paidByUserId))
		.where(
			and(
				eq(diningOrders.hotelId, hotelId),
				eq(diningOrders.discountKind, 'sc_pwd'),
				eq(diningOrders.paymentStatus, 'paid'),
				sql`${day}::date between ${from}::date and ${to}::date`
			)
		)
		.orderBy(asc(diningOrders.paidAt));
	const receipts = await receiptsBy(documents.diningOrderId, rows.map((r) => r.id));
	return rows.map((r) => {
		const guests = (r.claimants ?? []).map((c) => ({ type: c.type ?? null, name: c.name, idNumber: c.idNumber }));
		const n = guests.length || 1;
		// The qualifying share before the discount, worked out from the snapshot exactly as at the till.
		const before = { totalCentavos: r.total + r.discount + r.vat, vatCentavos: r.vatBefore ?? r.vat };
		const exempt = computeDiningDiscount(before, 'sc_pwd', r.bps ?? 0, n, r.diners ?? n).vatExemptCentavos;
		return {
			date: r.date ?? '',
			side: 'dining',
			ref: r.code,
			href: `trail/${r.code}`,
			guests,
			baseCentavos: exempt + r.discount,
			vatRemovedCentavos: r.vat,
			discountCentavos: r.discount,
			receipts: receipts.get(r.id) ?? [],
			givenBy: r.by,
			reversedOn: null,
			refundedAfterPaymentCentavos: r.after ? r.discount + r.vat : null
		};
	});
}

export async function scPwdDiscountReport(
	hotelId: string,
	from: string,
	to: string,
	scope: ReportScope,
	group: ScPwdGroup
): Promise<ScPwdReport> {
	const [hotel, dining] = await Promise.all([
		scope === 'dining' ? [] : hotelRows(hotelId, from, to),
		scope === 'hotel' ? [] : diningRows(hotelId, from, to)
	]);
	const trail = [...hotel, ...dining].sort((a, b) => a.date.localeCompare(b.date));
	return { trail, ...summarizeScPwd(trail, group) };
}
