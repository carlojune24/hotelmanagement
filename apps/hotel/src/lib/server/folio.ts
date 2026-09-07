import { and, asc, eq } from 'drizzle-orm';
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
export type FolioTarget = { kind: 'room'; bookingId: string } | { kind: 'hall'; hallBookingId: string };

function folioWhereFor(target: FolioTarget) {
	return target.kind === 'room' ? eq(folios.bookingId, target.bookingId) : eq(folios.hallBookingId, target.hallBookingId);
}

async function getOrderIdForTarget(target: FolioTarget): Promise<string | null> {
	if (target.kind === 'room') {
		const [row] = await db.select({ orderId: bookings.orderId }).from(bookings).where(eq(bookings.id, target.bookingId)).limit(1);
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
 * Ensures a folio exists for this target, creating one (seeded with a single line equal to
 * the room/hall booking's own already-priced total) the first time anyone touches it. That
 * seed line's matching payment already exists — the original payment, keyed to the same order
 * — so the folio's math starts exactly balanced and only owes anything once a new charge is
 * added without a matching new payment. Idempotent: safe to call on every read.
 */
async function ensureFolio(tx: Tx, hotelId: string, target: FolioTarget): Promise<string> {
	const [existing] = await tx.select({ id: folios.id }).from(folios).where(folioWhereFor(target)).limit(1);
	if (existing) return existing.id;

	let seedDescription: string;
	let seedTotalCentavos: number;

	if (target.kind === 'room') {
		const [booking] = await tx.select().from(bookings).where(eq(bookings.id, target.bookingId)).limit(1);
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
	chargesTotalCentavos: number;
	paidTotalCentavos: number;
	/** Positive = still owed; zero or less = settled. */
	balanceCentavos: number;
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

	const orderId = await getOrderIdForTarget(target);
	const paymentRows = orderId
		? await db
				.select({ amountCentavos: payments.amountCentavos })
				.from(payments)
				.where(and(eq(payments.orderId, orderId), eq(payments.status, 'paid')))
		: [];

	// Voided lines stay in the ledger for the audit trail (see the schema's own doc comment)
	// but never count toward what's actually owed.
	const chargesTotalCentavos = chargeRows.filter((c) => !c.voidedAt).reduce((sum, c) => sum + c.totalCentavos, 0);
	const paidTotalCentavos = paymentRows.reduce((sum, p) => sum + p.amountCentavos, 0);

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
		paidTotalCentavos,
		balanceCentavos: chargesTotalCentavos - paidTotalCentavos
	};
}

async function insertCharge(
	hotelId: string,
	target: FolioTarget,
	input: { description: string; quantity: number; unitPriceCentavos: number; taxable: boolean; amenityItemId?: string },
	actor: SessionUser | null
): Promise<void> {
	await db.transaction(async (tx) => {
		const folioId = await ensureFolio(tx, hotelId, target);
		const [hotel] = await tx.select({ vatRateBps: hotels.vatRateBps }).from(hotels).where(eq(hotels.id, hotelId)).limit(1);

		const subtotalCentavos = input.quantity * input.unitPriceCentavos;
		const taxCentavos = input.taxable ? Math.round((subtotalCentavos * (hotel?.vatRateBps ?? 0)) / 10000) : 0;

		await tx.insert(folioCharges).values({
			folioId,
			amenityItemId: input.amenityItemId ?? null,
			description: input.description,
			quantity: input.quantity,
			unitPriceCentavos: input.unitPriceCentavos,
			taxCentavos,
			totalCentavos: subtotalCentavos + taxCentavos,
			addedByUserId: actor?.id ?? null
		});
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
		.where(and(eq(amenityItems.id, amenityItemId), eq(amenityItems.hotelId, hotelId), eq(amenityItems.isActive, true)))
		.limit(1);
	if (!item) throw new FolioError('That item is no longer available.');

	await insertCharge(
		hotelId,
		target,
		{ description: item.name, quantity, unitPriceCentavos: item.priceCentavos, taxable: item.taxable, amenityItemId: item.id },
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

	const perHour = kind === 'late_checkout' ? hotel.lateCheckoutFeePerHourCentavos : hotel.earlyCheckInFeePerHourCentavos;
	if (perHour <= 0) throw new FolioError('No rate is configured for this fee — set it in Check-in & check-out settings.');
	const label = kind === 'late_checkout' ? 'Late checkout fee' : 'Early check-in fee';

	await insertCharge(
		hotelId,
		{ kind: 'room', bookingId },
		{ description: `${label} (${hours}h)`, quantity: hours, unitPriceCentavos: perHour, taxable: false },
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
		const [folio] = await tx.select({ id: folios.id }).from(folios).where(and(folioWhereFor(target), eq(folios.hotelId, hotelId))).limit(1);
		if (!folio) throw new FolioError('Folio not found.');

		const [charge] = await tx
			.select()
			.from(folioCharges)
			.where(and(eq(folioCharges.id, chargeId), eq(folioCharges.folioId, folio.id)))
			.limit(1);
		if (!charge) throw new FolioError('Charge not found.');
		if (charge.isBaseCharge) throw new FolioError('The room/hall stay charge itself can\'t be voided.');
		if (charge.voidedAt) throw new FolioError('That charge is already voided.');

		await tx
			.update(folioCharges)
			.set({ voidedAt: new Date(), voidedByUserId: actor?.id ?? null, voidReason: reason?.trim() || null })
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

/** Pays off the current outstanding balance in cash, on the spot — the front desk's only settlement path today. */
export async function settleFolioBalance(hotelId: string, target: FolioTarget, actor: SessionUser | null): Promise<void> {
	const detail = await getFolioDetail(hotelId, target);
	if (detail.balanceCentavos <= 0) throw new FolioError('There is no outstanding balance to settle.');

	const orderId = await getOrderIdForTarget(target);
	if (!orderId) throw new FolioError('Booking not found.');

	await db.insert(payments).values({
		orderId,
		provider: 'cash',
		status: 'paid',
		amountCentavos: detail.balanceCentavos,
		paidAt: new Date()
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'folio.settle_balance',
		entityType: target.kind === 'room' ? 'booking' : 'hall_booking',
		entityId: target.kind === 'room' ? target.bookingId : target.hallBookingId,
		after: { amountCentavos: detail.balanceCentavos }
	});
}

/** Marks a room booking's folio closed once it actually checks out — a historical marker, not a balance gate itself. */
export async function closeFolio(hotelId: string, bookingId: string): Promise<void> {
	const [folio] = await db.select({ id: folios.id }).from(folios).where(eq(folios.bookingId, bookingId)).limit(1);
	if (!folio) return;
	await db
		.update(folios)
		.set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(folios.id, folio.id), eq(folios.hotelId, hotelId)));
}
