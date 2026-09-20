import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from './db/index';
import { bookings, folioCharges, folios, hallBookings, orders, payments } from './db/schema/index';
import { orderLedgerTotals, type LedgerLine } from '$lib/ledger';

/**
 * Balance still owed per booking (order), batched so a list or grid never runs a query per row.
 * Same maths as `getOrderLedger` (charges over every line's folio, payments over the order), just
 * for many orders at once. Keyed by order id; an order with nothing owed maps to 0 or below.
 */
export async function orderBalances(
	hotelId: string,
	orderIds: string[]
): Promise<Map<string, number>> {
	const out = new Map<string, number>();
	const ids = [...new Set(orderIds)];
	if (ids.length === 0) return out;

	// Hotel-scoped: a foreign id can never resolve.
	const own = await db
		.select({ id: orders.id })
		.from(orders)
		.where(and(eq(orders.hotelId, hotelId), inArray(orders.id, ids)));
	const scoped = own.map((o) => o.id);
	if (scoped.length === 0) return out;

	const [roomLines, hallLines, payRows] = await Promise.all([
		db
			.select({
				id: bookings.id,
				orderId: bookings.orderId,
				status: bookings.status,
				total: bookings.totalCentavos
			})
			.from(bookings)
			.where(inArray(bookings.orderId, scoped)),
		db
			.select({
				id: hallBookings.id,
				orderId: hallBookings.orderId,
				status: hallBookings.status,
				total: hallBookings.totalCentavos
			})
			.from(hallBookings)
			.where(inArray(hallBookings.orderId, scoped)),
		db
			.select({ orderId: payments.orderId, amountCentavos: payments.amountCentavos })
			.from(payments)
			.where(
				and(
					inArray(payments.orderId, scoped),
					eq(payments.status, 'paid'),
					isNull(payments.voidedAt)
				)
			)
	]);

	const lineIds = [...roomLines, ...hallLines].map((l) => l.id);
	const folioByLine = new Map<string, string>();
	const chargesByFolio = new Map<string, number>();
	if (lineIds.length > 0) {
		const folioRows = await db
			.select({ id: folios.id, bookingId: folios.bookingId, hallBookingId: folios.hallBookingId })
			.from(folios)
			.where(or(inArray(folios.bookingId, lineIds), inArray(folios.hallBookingId, lineIds)));
		for (const f of folioRows) folioByLine.set((f.bookingId ?? f.hallBookingId)!, f.id);
		const folioIds = folioRows.map((f) => f.id);
		if (folioIds.length > 0) {
			const chargeRows = await db
				.select({ folioId: folioCharges.folioId, total: folioCharges.totalCentavos })
				.from(folioCharges)
				.where(and(inArray(folioCharges.folioId, folioIds), isNull(folioCharges.voidedAt)));
			for (const c of chargeRows) {
				chargesByFolio.set(c.folioId, (chargesByFolio.get(c.folioId) ?? 0) + c.total);
			}
		}
	}

	const linesByOrder = new Map<string, LedgerLine[]>();
	for (const l of [...roomLines, ...hallLines]) {
		const folioId = folioByLine.get(l.id);
		const line: LedgerLine = {
			folioChargesCentavos: folioId ? (chargesByFolio.get(folioId) ?? 0) : null,
			totalCentavos: l.total,
			status: l.status
		};
		const arr = linesByOrder.get(l.orderId) ?? [];
		arr.push(line);
		linesByOrder.set(l.orderId, arr);
	}
	const paidByOrder = new Map<string, number>();
	for (const p of payRows) {
		paidByOrder.set(p.orderId, (paidByOrder.get(p.orderId) ?? 0) + p.amountCentavos);
	}

	for (const id of scoped) {
		out.set(id, orderLedgerTotals(linesByOrder.get(id) ?? [], paidByOrder.get(id) ?? 0).balanceCentavos);
	}
	return out;
}
