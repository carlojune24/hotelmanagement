import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { lineChargesCentavos, type OrderLedgerTotals } from '$lib/ledger';
import { roomPaidCentavos, type RoomPayRow } from '$lib/allocation';
import { db } from './db/index';
import {
	amenityItems,
	bookings,
	folioCharges,
	folios,
	functionHalls,
	hallBookings,
	hotels,
	orders,
	paymentAllocations,
	payments
} from './db/schema/index';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';

/** The transaction object `db.transaction(async (tx) => ...)` hands its callback — derived
 *  from `db` itself rather than importing a driver-specific type, so this stays correct
 *  regardless of which drizzle driver `lib/server/db/index.ts` is actually configured with. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class FolioError extends Error {}

/** A folio always belongs to exactly one of these — see `folios_exactly_one_target` in the schema. */
export type FolioTarget =
	{ kind: 'room'; bookingId: string } | { kind: 'hall'; hallBookingId: string };

function folioWhereFor(target: FolioTarget) {
	return target.kind === 'room'
		? eq(folios.bookingId, target.bookingId)
		: eq(folios.hallBookingId, target.hallBookingId);
}

export async function getOrderIdForTarget(target: FolioTarget): Promise<string | null> {
	if (target.kind === 'room') {
		const [row] = await db
			.select({ orderId: bookings.orderId })
			.from(bookings)
			.where(eq(bookings.id, target.bookingId))
			.limit(1);
		return row?.orderId ?? null;
	}
	const [row] = await db
		.select({ orderId: hallBookings.orderId })
		.from(hallBookings)
		.where(eq(hallBookings.id, target.hallBookingId))
		.limit(1);
	return row?.orderId ?? null;
}


/**
 * Per-room money for a booking. Every room keeps its own charges, payments and balance; the order
 * is the parent only for viewing (the booking totals are just the sum of its rooms) and for taking
 * one payment across several rooms (`payment_allocations`). A room's paid amount follows
 * `roomPaidCentavos` in `$lib/allocation`. Read-only: a room with no folio yet is counted from its
 * own total (see `lineChargesCentavos`), never given one.
 */
export interface OrderLedgerLine {
	kind: 'room' | 'hall';
	id: string;
	status: string;
	/** This room's / hall's own charges. */
	chargesCentavos: number;
	/** What this room has been paid (its share of every payment, refunds subtracted). */
	paidCentavos: number;
	/** Charges − paid: positive = this room still owes, negative = in credit. */
	balanceCentavos: number;
}

export interface OrderLedger extends OrderLedgerTotals {
	lines: OrderLedgerLine[];
}

const emptyLedger = (): OrderLedger => ({
	chargesTotalCentavos: 0,
	paidTotalCentavos: 0,
	balanceCentavos: 0,
	lines: []
});

/** Batched: the per-room ledger of many orders at once (lists and grids never query per row). */
export async function loadOrderLedgers(orderIds: string[]): Promise<Map<string, OrderLedger>> {
	const out = new Map<string, OrderLedger>();
	const ids = [...new Set(orderIds)];
	if (ids.length === 0) return out;

	const [roomLines, hallLines, payRows] = await Promise.all([
		db
			.select({
				id: bookings.id,
				orderId: bookings.orderId,
				status: bookings.status,
				total: bookings.totalCentavos
			})
			.from(bookings)
			.where(inArray(bookings.orderId, ids)),
		db
			.select({
				id: hallBookings.id,
				orderId: hallBookings.orderId,
				status: hallBookings.status,
				total: hallBookings.totalCentavos
			})
			.from(hallBookings)
			.where(inArray(hallBookings.orderId, ids)),
		db
			.select({
				id: payments.id,
				orderId: payments.orderId,
				amountCentavos: payments.amountCentavos,
				folioId: payments.folioId
			})
			.from(payments)
			.where(
				and(inArray(payments.orderId, ids), eq(payments.status, 'paid'), isNull(payments.voidedAt))
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

	const allocByPayment = new Map<string, { lineId: string; amountCentavos: number }[]>();
	if (payRows.length > 0) {
		const allocRows = await db
			.select({
				paymentId: paymentAllocations.paymentId,
				bookingId: paymentAllocations.bookingId,
				hallBookingId: paymentAllocations.hallBookingId,
				amountCentavos: paymentAllocations.amountCentavos
			})
			.from(paymentAllocations)
			.where(inArray(paymentAllocations.paymentId, payRows.map((p) => p.id)));
		for (const a of allocRows) {
			const arr = allocByPayment.get(a.paymentId) ?? [];
			arr.push({ lineId: (a.bookingId ?? a.hallBookingId)!, amountCentavos: a.amountCentavos });
			allocByPayment.set(a.paymentId, arr);
		}
	}

	type L = { key: string; kind: 'room' | 'hall'; id: string; orderId: string; status: string; total: number };
	const linesByOrder = new Map<string, L[]>();
	for (const l of roomLines) {
		const arr = linesByOrder.get(l.orderId) ?? [];
		arr.push({ key: `a:${l.id}`, kind: 'room', id: l.id, orderId: l.orderId, status: l.status, total: l.total });
		linesByOrder.set(l.orderId, arr);
	}
	for (const l of hallLines) {
		const arr = linesByOrder.get(l.orderId) ?? [];
		arr.push({ key: `b:${l.id}`, kind: 'hall', id: l.id, orderId: l.orderId, status: l.status, total: l.total });
		linesByOrder.set(l.orderId, arr);
	}

	for (const orderId of ids) {
		// One stable order (rooms then halls, by id) so every caller computes the identical split.
		const lines = (linesByOrder.get(orderId) ?? []).sort((x, y) => (x.key < y.key ? -1 : 1));
		const rows: RoomPayRow[] = payRows
			.filter((p) => p.orderId === orderId)
			.map((p) => ({
				amountCentavos: p.amountCentavos,
				folioId: p.folioId,
				allocations: allocByPayment.get(p.id) ?? []
			}));
		const splitLines = lines.map((l) => ({ id: l.id, total: l.total }));
		const ledgerLines: OrderLedgerLine[] = lines.map((l) => {
			const folioId = folioByLine.get(l.id) ?? null;
			const charges = lineChargesCentavos({
				folioChargesCentavos: folioId ? (chargesByFolio.get(folioId) ?? 0) : null,
				totalCentavos: l.total,
				status: l.status
			});
			const paid = roomPaidCentavos({ rows, folioId, lineId: l.id, lines: splitLines });
			return {
				kind: l.kind,
				id: l.id,
				status: l.status,
				chargesCentavos: charges,
				paidCentavos: paid,
				balanceCentavos: charges - paid
			};
		});
		out.set(orderId, {
			chargesTotalCentavos: ledgerLines.reduce((sum, l) => sum + l.chargesCentavos, 0),
			paidTotalCentavos: ledgerLines.reduce((sum, l) => sum + l.paidCentavos, 0),
			balanceCentavos: ledgerLines.reduce((sum, l) => sum + l.balanceCentavos, 0),
			lines: ledgerLines
		});
	}
	return out;
}

export async function getOrderLedger(orderId: string): Promise<OrderLedger> {
	return (await loadOrderLedgers([orderId])).get(orderId) ?? emptyLedger();
}

/**
 * Ensures a folio exists for this target, creating one (seeded with a single line equal to
 * the room/hall booking's own already-priced total) the first time anyone touches it. That
 * seed line's matching payment already exists — the original payment, keyed to the same order
 * — so the folio's math starts exactly balanced and only owes anything once a new charge is
 * added without a matching new payment. Idempotent: safe to call on every read.
 */
export async function ensureFolio(tx: Tx, hotelId: string, target: FolioTarget): Promise<string> {
	const [existing] = await tx
		.select({ id: folios.id })
		.from(folios)
		.where(folioWhereFor(target))
		.limit(1);
	if (existing) return existing.id;

	let seedDescription: string;
	let seedTotalCentavos: number;

	if (target.kind === 'room') {
		const [booking] = await tx
			.select()
			.from(bookings)
			.where(eq(bookings.id, target.bookingId))
			.limit(1);
		if (!booking || booking.hotelId !== hotelId) throw new FolioError('Booking not found.');
		seedDescription = `Room stay (${booking.checkIn} – ${booking.checkOut})`;
		seedTotalCentavos = booking.totalCentavos;
	} else {
		const [row] = await tx
			.select({ hallBooking: hallBookings, hallName: functionHalls.name, hotelId: orders.hotelId })
			.from(hallBookings)
			.innerJoin(orders, eq(orders.id, hallBookings.orderId))
			.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
			.where(eq(hallBookings.id, target.hallBookingId))
			.limit(1);
		if (!row || row.hotelId !== hotelId) throw new FolioError('Hall booking not found.');
		seedDescription = `Function hall: ${row.hallName} (${row.hallBooking.eventDate})`;
		seedTotalCentavos = row.hallBooking.totalCentavos;
	}

	const [folio] = await tx
		.insert(folios)
		.values({
			hotelId,
			bookingId: target.kind === 'room' ? target.bookingId : null,
			hallBookingId: target.kind === 'hall' ? target.hallBookingId : null
		})
		.returning({ id: folios.id });

	await tx.insert(folioCharges).values({
		folioId: folio!.id,
		description: seedDescription,
		quantity: 1,
		unitPriceCentavos: seedTotalCentavos,
		taxCentavos: 0,
		totalCentavos: seedTotalCentavos,
		isBaseCharge: true
	});

	return folio!.id;
}

export interface FolioChargeLine {
	id: string;
	description: string;
	quantity: number;
	unitPriceCentavos: number;
	taxCentavos: number;
	totalCentavos: number;
	isBaseCharge: boolean;
	voidedAt: Date | null;
	voidReason: string | null;
	createdAt: Date;
}

export interface FolioDetail {
	folioId: string;
	status: 'open' | 'closed';
	charges: FolioChargeLine[];
	/** THIS room's / hall's own charges. */
	chargesTotalCentavos: number;
	/** What THIS room has been paid (its share of every payment — see `roomPaidCentavos`). */
	paidTotalCentavos: number;
	/** What THIS room still owes; zero or less = settled. Every consumer that gates on "is this
	 *  room settled?" (payment cap, check-out, city ledger) wants this. */
	balanceCentavos: number;
	/** The whole booking's totals, for context (each is the sum of its rooms). */
	orderPaidTotalCentavos: number;
	orderBalanceCentavos: number;
	/** Charges across every line of the order. */
	orderChargesTotalCentavos: number;
	/** How many room / hall lines the order has — more than one means a multi-room booking. */
	orderLineCount: number;
}

/** Read (creating the folio first if this target has never had one touched). */
export async function getFolioDetail(hotelId: string, target: FolioTarget): Promise<FolioDetail> {
	const folioId = await db.transaction((tx) => ensureFolio(tx, hotelId, target));

	const [folio] = await db.select().from(folios).where(eq(folios.id, folioId)).limit(1);
	const chargeRows = await db
		.select()
		.from(folioCharges)
		.where(eq(folioCharges.folioId, folioId))
		.orderBy(asc(folioCharges.createdAt));

	// Per-room: this room's own charges against what THIS room has been paid (its share of the
	// order's payments, `getOrderLedger`). A `refund`-purpose payment is negative, so it raises
	// the balance.
	const orderId = await getOrderIdForTarget(target);
	const ledger = orderId ? await getOrderLedger(orderId) : null;
	const thisLineId = target.kind === 'room' ? target.bookingId : target.hallBookingId;
	const thisLine = ledger?.lines.find((l) => l.id === thisLineId) ?? null;

	// Voided lines stay in the ledger for the audit trail (see the schema's own doc comment)
	// but never count toward what's actually owed.
	const chargesTotalCentavos = chargeRows
		.filter((c) => !c.voidedAt)
		.reduce((sum, c) => sum + c.totalCentavos, 0);

	return {
		folioId,
		status: folio!.status,
		charges: chargeRows.map((c) => ({
			id: c.id,
			description: c.description,
			quantity: c.quantity,
			unitPriceCentavos: c.unitPriceCentavos,
			taxCentavos: c.taxCentavos,
			totalCentavos: c.totalCentavos,
			isBaseCharge: c.isBaseCharge,
			voidedAt: c.voidedAt,
			voidReason: c.voidReason,
			createdAt: c.createdAt
		})),
		chargesTotalCentavos,
		paidTotalCentavos: thisLine?.paidCentavos ?? 0,
		balanceCentavos: chargesTotalCentavos - (thisLine?.paidCentavos ?? 0),
		orderPaidTotalCentavos: ledger?.paidTotalCentavos ?? 0,
		orderBalanceCentavos: ledger?.balanceCentavos ?? chargesTotalCentavos,
		orderChargesTotalCentavos: ledger?.chargesTotalCentavos ?? chargesTotalCentavos,
		orderLineCount: ledger?.lines.length ?? 1
	};
}

async function insertCharge(
	hotelId: string,
	target: FolioTarget,
	input: {
		description: string;
		quantity: number;
		unitPriceCentavos: number;
		taxable: boolean;
		amenityItemId?: string;
	},
	actor: SessionUser | null
): Promise<{ chargeId: string }> {
	return await db.transaction(async (tx) => {
		const folioId = await ensureFolio(tx, hotelId, target);
		const [hotel] = await tx
			.select({ vatRateBps: hotels.vatRateBps })
			.from(hotels)
			.where(eq(hotels.id, hotelId))
			.limit(1);

		const subtotalCentavos = input.quantity * input.unitPriceCentavos;
		const taxCentavos = input.taxable
			? Math.round((subtotalCentavos * (hotel?.vatRateBps ?? 0)) / 10000)
			: 0;

		const [charge] = await tx
			.insert(folioCharges)
			.values({
				folioId,
				amenityItemId: input.amenityItemId ?? null,
				description: input.description,
				quantity: input.quantity,
				unitPriceCentavos: input.unitPriceCentavos,
				taxCentavos,
				totalCentavos: subtotalCentavos + taxCentavos,
				addedByUserId: actor?.id ?? null
			})
			.returning({ id: folioCharges.id });
		if (!charge) throw new FolioError('Could not post the charge.');

		return { chargeId: charge.id };
	});
}

/** Adds a catalog item to a folio (room or hall) — the priced/taxable posture front desk works from. */
export async function addAmenityItemCharge(
	hotelId: string,
	target: FolioTarget,
	amenityItemId: string,
	quantity: number,
	actor: SessionUser | null
): Promise<void> {
	const [item] = await db
		.select()
		.from(amenityItems)
		.where(
			and(
				eq(amenityItems.id, amenityItemId),
				eq(amenityItems.hotelId, hotelId),
				eq(amenityItems.isActive, true)
			)
		)
		.limit(1);
	if (!item) throw new FolioError('That item is no longer available.');

	await insertCharge(
		hotelId,
		target,
		{
			description: item.name,
			quantity,
			unitPriceCentavos: item.priceCentavos,
			taxable: item.taxable,
			amenityItemId: item.id
		},
		actor
	);

	await writeAudit({
		hotelId,
		actor,
		action: 'folio.add_item_charge',
		entityType: target.kind === 'room' ? 'booking' : 'hall_booking',
		entityId: target.kind === 'room' ? target.bookingId : target.hallBookingId,
		after: { amenityItemId, quantity }
	});
}

/** A free-text, arbitrary-amount charge with no catalog entry behind it — e.g. a
 *  room-damage line ("Damage: broken lamp — ₱3,000"). Quantity is always 1; the
 *  amount is whatever staff types, unlike `addAmenityItemCharge`'s catalog price. */
export async function addAdHocCharge(
	hotelId: string,
	target: FolioTarget,
	input: { description: string; amountCentavos: number; taxable: boolean },
	actor: SessionUser | null
): Promise<{ chargeId: string }> {
	if (!input.description.trim()) throw new FolioError('Enter a description for this charge.');
	if (!Number.isInteger(input.amountCentavos) || input.amountCentavos <= 0) {
		throw new FolioError('Enter a charge amount greater than zero.');
	}

	const { chargeId } = await insertCharge(
		hotelId,
		target,
		{
			description: input.description.trim(),
			quantity: 1,
			unitPriceCentavos: input.amountCentavos,
			taxable: input.taxable
		},
		actor
	);

	await writeAudit({
		hotelId,
		actor,
		action: 'folio.add_adhoc_charge',
		entityType: target.kind === 'room' ? 'booking' : 'hall_booking',
		entityId: target.kind === 'room' ? target.bookingId : target.hallBookingId,
		after: { description: input.description.trim(), amountCentavos: input.amountCentavos }
	});

	return { chargeId };
}

export type ExtensionFeeKind = 'late_checkout' | 'early_check_in';

/** One-click charge for the per-hour late-checkout/early-check-in rates set in hotel settings —
 *  a room concept only (a hall reservation has no check-in/check-out clock to extend). */
export async function addExtensionFeeCharge(
	hotelId: string,
	bookingId: string,
	kind: ExtensionFeeKind,
	hours: number,
	actor: SessionUser | null
): Promise<void> {
	const [hotel] = await db
		.select({
			lateCheckoutFeePerHourCentavos: hotels.lateCheckoutFeePerHourCentavos,
			earlyCheckInFeePerHourCentavos: hotels.earlyCheckInFeePerHourCentavos
		})
		.from(hotels)
		.where(eq(hotels.id, hotelId))
		.limit(1);
	if (!hotel) throw new FolioError('Hotel not found.');

	const perHour =
		kind === 'late_checkout'
			? hotel.lateCheckoutFeePerHourCentavos
			: hotel.earlyCheckInFeePerHourCentavos;
	if (perHour <= 0)
		throw new FolioError(
			'No rate is configured for this fee — set it in Check-in & check-out settings.'
		);
	const label = kind === 'late_checkout' ? 'Late checkout fee' : 'Early check-in fee';

	await insertCharge(
		hotelId,
		{ kind: 'room', bookingId },
		{
			description: `${label} (${hours}h)`,
			quantity: hours,
			unitPriceCentavos: perHour,
			taxable: false
		},
		actor
	);

	await writeAudit({
		hotelId,
		actor,
		action: 'folio.add_extension_fee',
		entityType: 'booking',
		entityId: bookingId,
		after: { kind, hours }
	});
}

/**
 * Soft-voids a mistakenly-added charge — wrong item, wrong quantity, whatever — so it stops
 * counting toward the balance without erasing that it was ever added. The seeded base charge
 * (the room/hall booking's own total) can never be voided this way; refuses instead. If the
 * charge had already been settled, voiding it can legitimately put the balance in credit
 * (negative) — that's shown honestly, not clamped to zero; handing back the physical cash is
 * on front desk, same as every other money movement this app doesn't automate.
 */
export async function voidFolioCharge(
	hotelId: string,
	target: FolioTarget,
	chargeId: string,
	reason: string | null,
	actor: SessionUser | null
): Promise<void> {
	await db.transaction(async (tx) => {
		const [folio] = await tx
			.select({ id: folios.id })
			.from(folios)
			.where(and(folioWhereFor(target), eq(folios.hotelId, hotelId)))
			.limit(1);
		if (!folio) throw new FolioError('Folio not found.');

		const [charge] = await tx
			.select()
			.from(folioCharges)
			.where(and(eq(folioCharges.id, chargeId), eq(folioCharges.folioId, folio.id)))
			.limit(1);
		if (!charge) throw new FolioError('Charge not found.');
		if (charge.isBaseCharge)
			throw new FolioError("The room/hall stay charge itself can't be voided.");
		if (charge.voidedAt) throw new FolioError('That charge is already voided.');

		await tx
			.update(folioCharges)
			.set({
				voidedAt: new Date(),
				voidedByUserId: actor?.id ?? null,
				voidReason: reason?.trim() || null
			})
			.where(eq(folioCharges.id, chargeId));
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'folio.void_charge',
		entityType: target.kind === 'room' ? 'booking' : 'hall_booking',
		entityId: target.kind === 'room' ? target.bookingId : target.hallBookingId,
		after: { chargeId, reason: reason || null }
	});
}

// `settleFolioBalance` was removed — payments now go through
// `lib/server/finance/payments.ts`'s `recordPayment` (method, tendered/change,
// partial amounts) which also writes the matching `cash_movements` row.

/** Marks a room booking's folio closed once it actually checks out — a historical marker, not a balance gate itself. */
export async function closeFolio(hotelId: string, bookingId: string): Promise<void> {
	const [folio] = await db
		.select({ id: folios.id })
		.from(folios)
		.where(eq(folios.bookingId, bookingId))
		.limit(1);
	if (!folio) return;
	await db
		.update(folios)
		.set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(folios.id, folio.id), eq(folios.hotelId, hotelId)));
}
