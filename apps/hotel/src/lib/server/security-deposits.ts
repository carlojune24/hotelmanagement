import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from './db/index';
import {
	bookingRooms,
	bookings,
	cashMovements,
	guests,
	hotels,
	orders,
	payments,
	roomTypes,
	securityDepositPolicies,
	securityDeposits,
	type SecurityDeposit,
	type SecurityDepositPolicy
} from './db/schema/index';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';
import { ensureFolio, getFolioDetail, FolioError } from './folio';
import { businessDateFor, type Tx } from './finance/shared';
import { recordCashMovement, voidCashMovement } from './finance/cash';
import { resolvePaymentAccount, type PaymentMethod } from './finance/payments';

export class SecurityDepositError extends Error {}

export interface CollectSecurityDepositInput {
	hotelId: string;
	bookingId: string;
	securityDepositPolicyId?: string | null;
	amountCentavos: number;
	method: PaymentMethod;
	tenderedCentavos?: number | null;
	referenceNo?: string | null;
	/** Override the auto-picked account, same convention as `recordPayment`. */
	cashAccountId?: string | null;
	actor: SessionUser | null;
}

/** A hotel's security deposit policy by id, or null. Used by the check-in load to
 *  resolve a rate plan's `securityDepositPolicyId` into the amount to collect. */
export async function getSecurityDepositPolicy(
	hotelId: string,
	policyId: string
): Promise<SecurityDepositPolicy | null> {
	const [row] = await db
		.select()
		.from(securityDepositPolicies)
		.where(and(eq(securityDepositPolicies.id, policyId), eq(securityDepositPolicies.hotelId, hotelId)))
		.limit(1);
	return row ?? null;
}

/** The current (most recent) deposit row for a booking, or null if none was ever
 *  collected. Used by both the check-in load (to decide whether to show the collect
 *  form) and the checkout panel (to show held/settled state). */
export async function getSecurityDepositForBooking(
	hotelId: string,
	bookingId: string
): Promise<SecurityDeposit | null> {
	const [row] = await db
		.select()
		.from(securityDeposits)
		.where(and(eq(securityDeposits.hotelId, hotelId), eq(securityDeposits.bookingId, bookingId)))
		.orderBy(desc(securityDeposits.createdAt))
		.limit(1);
	return row ?? null;
}

export interface SecurityDepositListRow {
	id: string;
	bookingId: string | null;
	status: 'held' | 'settled' | 'voided';
	amountCentavos: number;
	method: PaymentMethod;
	referenceNo: string | null;
	collectedAt: Date;
	forfeitedCentavos: number | null;
	refundedCentavos: number | null;
	settledAt: Date | null;
	voidedAt: Date | null;
	voidReason: string | null;
	guestName: string | null;
	checkIn: string | null;
	checkOut: string | null;
	roomTypeName: string | null;
}

/** Every deposit for the hotel, newest first — the single place to see what's held,
 *  what's been refunded, and what's been forfeited (and why), across every booking. */
export async function listSecurityDeposits(
	hotelId: string,
	opts: { status?: 'held' | 'settled' | 'voided' } = {}
): Promise<SecurityDepositListRow[]> {
	const conds = [eq(securityDeposits.hotelId, hotelId)];
	if (opts.status) conds.push(eq(securityDeposits.status, opts.status));

	return db
		.select({
			id: securityDeposits.id,
			bookingId: securityDeposits.bookingId,
			status: securityDeposits.status,
			amountCentavos: securityDeposits.amountCentavos,
			method: securityDeposits.method,
			referenceNo: securityDeposits.referenceNo,
			collectedAt: securityDeposits.collectedAt,
			forfeitedCentavos: securityDeposits.forfeitedCentavos,
			refundedCentavos: securityDeposits.refundedCentavos,
			settledAt: securityDeposits.settledAt,
			voidedAt: securityDeposits.voidedAt,
			voidReason: securityDeposits.voidReason,
			guestName: guests.fullName,
			checkIn: bookings.checkIn,
			checkOut: bookings.checkOut,
			roomTypeName: roomTypes.name
		})
		.from(securityDeposits)
		.leftJoin(bookings, eq(bookings.id, securityDeposits.bookingId))
		.leftJoin(orders, eq(orders.id, bookings.orderId))
		.leftJoin(guests, eq(guests.id, orders.guestId))
		.leftJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.leftJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
		.where(and(...conds))
		.orderBy(desc(securityDeposits.collectedAt));
}

/** Pure netting math, unit-testable without a DB — same extraction pattern as
 *  `cancellation.ts`'s `computeCancellationFee`. A negative/credit folio balance
 *  clamps to zero forfeited, never goes negative. */
export function computeSecurityDepositSettlement(input: {
	heldCentavos: number;
	folioBalanceCentavos: number;
}): { forfeitedCentavos: number; refundedCentavos: number } {
	const forfeitedCentavos = Math.min(input.heldCentavos, Math.max(0, input.folioBalanceCentavos));
	return {
		forfeitedCentavos,
		refundedCentavos: input.heldCentavos - forfeitedCentavos
	};
}

/**
 * Collects the refundable room-damage hold at check-in. Writes one `security_deposits`
 * row (`status: 'held'`) plus an `in: security_deposit_hold` cash movement — never a
 * `payments` row, so it never enters `getFolioDetail`'s balance math (a hold is
 * collateral, not folio revenue). Refuses if this booking already has a `held` deposit
 * (the partial unique index backstops this too).
 */
export async function collectSecurityDeposit(
	input: CollectSecurityDepositInput
): Promise<{ securityDepositId: string }> {
	if (!Number.isInteger(input.amountCentavos) || input.amountCentavos <= 0) {
		throw new SecurityDepositError('Enter a deposit amount greater than zero.');
	}

	const [booking] = await db
		.select({ hotelId: bookings.hotelId })
		.from(bookings)
		.where(eq(bookings.id, input.bookingId))
		.limit(1);
	if (!booking || booking.hotelId !== input.hotelId) {
		throw new SecurityDepositError('Booking not found.');
	}

	const existing = await getSecurityDepositForBooking(input.hotelId, input.bookingId);
	if (existing?.status === 'held') {
		throw new SecurityDepositError('A deposit is already held for this booking.');
	}

	const [hotel] = await db
		.select({ timezone: hotels.timezone })
		.from(hotels)
		.where(eq(hotels.id, input.hotelId))
		.limit(1);
	const businessDate = businessDateFor(hotel?.timezone ?? 'Asia/Manila');

	const resolved = await resolvePaymentAccount(input.hotelId, input.method);
	const cashAccountId = input.cashAccountId ?? resolved.cashAccountId;

	const securityDepositId = await db.transaction(async (tx: Tx) => {
		const [row] = await tx
			.insert(securityDeposits)
			.values({
				hotelId: input.hotelId,
				bookingId: input.bookingId,
				securityDepositPolicyId: input.securityDepositPolicyId ?? null,
				status: 'held',
				amountCentavos: input.amountCentavos,
				cashAccountId,
				method: input.method,
				referenceNo: input.referenceNo?.trim() || null,
				collectedByUserId: input.actor?.id ?? null
			})
			.returning({ id: securityDeposits.id });

		await recordCashMovement(
			{
				hotelId: input.hotelId,
				businessDate,
				direction: 'in',
				category: 'security_deposit_hold',
				cashAccountId,
				amountCentavos: input.amountCentavos,
				counterpartyType: 'guest',
				sourceType: 'security_deposit',
				sourceId: row!.id,
				memo: 'Security deposit collected at check-in',
				actor: input.actor
			},
			tx
		);

		return row!.id;
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'security_deposit.collect',
		entityType: 'booking',
		entityId: input.bookingId,
		after: { securityDepositId, amountCentavos: input.amountCentavos, method: input.method }
	});

	return { securityDepositId };
}

/**
 * Settles a held deposit at (or just before) checkout. Nets the held amount against
 * whatever's still unpaid *on this folio specifically* — deliberately NOT the folio's
 * `balanceCentavos` from `getFolioDetail`, which sums payments by `orders.id`. For a
 * multi-room order paid as one lump sum at booking time, that order-wide payment gets
 * counted against *every* sibling room's own balance check, making each one look
 * far overpaid regardless of what's actually unsettled on it — silently zeroing out
 * forfeiture for real damage. Instead:
 *   damageCharges = sum of non-base, non-voided folio charges (everything added after
 *                   check-in, never the seeded room-stay charge)
 *   directPayments = sum of payments with `folioId` = *this* folio's id — a payment
 *                    taken specifically against this room, e.g. via "Take payment"; the
 *                    original order-wide booking payment never carries a `folioId`, so
 *                    it's excluded
 *   baseCharges = sum of the folio's own base (room-stay) charges
 *   excessPayment = max(0, directPayments − baseCharges) — a direct payment is applied
 *                   to the base charges first; only what's left over after that is
 *                   available to offset damage. Without this, a payment taken to settle
 *                   the room-stay charge itself (e.g. tendered before damage was found)
 *                   gets double-counted: once implicitly (it already squares the base
 *                   charge) and again here, silently shorting the forfeiture by the same
 *                   amount and leaving that same peso "due" on the folio afterward.
 *   damageOwed = max(0, damageCharges − excessPayment)
 *   forfeited = min(heldCentavos, max(0, damageOwed))
 *   refunded  = heldCentavos - forfeited
 * In one transaction:
 *   1. If forfeited > 0: insert a `payments` row directly (`method: 'security_deposit',
 *      purpose: 'settlement', status: 'paid'`) for `forfeited` — squares that much of
 *      the folio balance without new cash. Same *mechanism* `finance/receivables.ts`'s
 *      `openReceivable` uses for the city ledger (`method: 'house_use'`), but its own
 *      distinct method value — reusing `house_use` here mislabeled the guest's Official
 *      Receipt as "City ledger", which this never is.
 *   2. `recordCashMovement` OUT `security_deposit_refund` for the FULL `heldCentavos`
 *      — fully clears the liability.
 *   3. If forfeited > 0: `recordCashMovement` IN `other_revenue` for `forfeited` —
 *      recognizes the kept portion as revenue.
 *   Steps 2+3 are a "wash": net cash out = heldCentavos − forfeited, exactly what
 *   physically gets handed back to the guest.
 *   4. Update the `security_deposits` row: `status: 'settled'`, forfeited/refunded,
 *      settledAt/settledByUserId.
 * Damage beyond the held amount is NOT resolved here — it's left as an ordinary
 * positive folio balance, which `checkOutBooking`'s existing balance gate already
 * enforces.
 */
export async function settleSecurityDeposit(
	hotelId: string,
	bookingId: string,
	actor: SessionUser | null
): Promise<{
	heldCentavos: number;
	forfeitedCentavos: number;
	refundedCentavos: number;
	remainingFolioBalanceCentavos: number;
}> {
	const deposit = await getSecurityDepositForBooking(hotelId, bookingId);
	if (!deposit || deposit.status !== 'held') {
		throw new SecurityDepositError('No held deposit found for this booking.');
	}

	let folio;
	try {
		folio = await getFolioDetail(hotelId, { kind: 'room', bookingId });
	} catch (e) {
		if (e instanceof FolioError) throw new SecurityDepositError(e.message);
		throw e;
	}

	const baseChargesCentavos = folio.charges
		.filter((c) => c.isBaseCharge && !c.voidedAt)
		.reduce((sum, c) => sum + c.totalCentavos, 0);
	const damageChargesCentavos = folio.charges
		.filter((c) => !c.isBaseCharge && !c.voidedAt)
		.reduce((sum, c) => sum + c.totalCentavos, 0);
	const directPaymentRows = await db
		.select({ amountCentavos: payments.amountCentavos })
		.from(payments)
		.where(
			and(eq(payments.folioId, folio.folioId), eq(payments.status, 'paid'), isNull(payments.voidedAt))
		);
	const directFolioPaymentsCentavos = directPaymentRows.reduce((sum, p) => sum + p.amountCentavos, 0);
	const excessPaymentCentavos = Math.max(0, directFolioPaymentsCentavos - baseChargesCentavos);
	const damageOwedCentavos = Math.max(0, damageChargesCentavos - excessPaymentCentavos);

	const { forfeitedCentavos, refundedCentavos } = computeSecurityDepositSettlement({
		heldCentavos: deposit.amountCentavos,
		folioBalanceCentavos: damageOwedCentavos
	});

	const [hotel] = await db
		.select({ timezone: hotels.timezone })
		.from(hotels)
		.where(eq(hotels.id, hotelId))
		.limit(1);
	const businessDate = businessDateFor(hotel?.timezone ?? 'Asia/Manila');

	await db.transaction(async (tx: Tx) => {
		if (forfeitedCentavos > 0) {
			const folioId = await ensureFolio(tx, hotelId, { kind: 'room', bookingId });
			const [order] = await tx
				.select({ orderId: bookings.orderId })
				.from(bookings)
				.where(eq(bookings.id, bookingId))
				.limit(1);
			if (!order) throw new SecurityDepositError('Booking not found.');

			await tx.insert(payments).values({
				orderId: order.orderId,
				provider: 'cash',
				method: 'security_deposit',
				purpose: 'settlement',
				status: 'paid',
				amountCentavos: forfeitedCentavos,
				folioId,
				recordedByUserId: actor?.id ?? null,
				paidAt: new Date()
			});
		}

		await recordCashMovement(
			{
				hotelId,
				businessDate,
				direction: 'out',
				category: 'security_deposit_refund',
				cashAccountId: deposit.cashAccountId,
				amountCentavos: deposit.amountCentavos,
				counterpartyType: 'guest',
				sourceType: 'security_deposit',
				sourceId: deposit.id,
				memo: 'Security deposit settled at checkout',
				actor
			},
			tx
		);

		if (forfeitedCentavos > 0) {
			await recordCashMovement(
				{
					hotelId,
					businessDate,
					direction: 'in',
					category: 'other_revenue',
					cashAccountId: deposit.cashAccountId,
					amountCentavos: forfeitedCentavos,
					counterpartyType: 'guest',
					sourceType: 'security_deposit',
					sourceId: deposit.id,
					memo: 'Security deposit forfeited for damage',
					actor
				},
				tx
			);
		}

		await tx
			.update(securityDeposits)
			.set({
				status: 'settled',
				forfeitedCentavos,
				refundedCentavos,
				settledByUserId: actor?.id ?? null,
				settledAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(securityDeposits.id, deposit.id));
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'security_deposit.settle',
		entityType: 'booking',
		entityId: bookingId,
		after: { securityDepositId: deposit.id, forfeitedCentavos, refundedCentavos }
	});

	return {
		heldCentavos: deposit.amountCentavos,
		forfeitedCentavos,
		refundedCentavos,
		// This booking's own damage still unpaid after applying the deposit — not the
		// same thing as `checkOutBooking`'s own balance gate, which still reads
		// `getFolioDetail`'s order-wide balance directly (see the doc comment above).
		// A multi-room order can therefore show ₱0 remaining here yet still block
		// checkout on a *different* sibling's unpaid charge.
		remainingFolioBalanceCentavos: Math.max(0, damageOwedCentavos - forfeitedCentavos)
	};
}

/** Voids a mistakenly-collected hold before it's ever settled — reverses the cash
 *  movement and marks the row 'voided'. Refuses once 'settled'. */
export async function voidSecurityDeposit(
	hotelId: string,
	securityDepositId: string,
	reason: string | null,
	actor: SessionUser | null
): Promise<void> {
	const [deposit] = await db
		.select()
		.from(securityDeposits)
		.where(and(eq(securityDeposits.id, securityDepositId), eq(securityDeposits.hotelId, hotelId)))
		.limit(1);
	if (!deposit) throw new SecurityDepositError('Deposit not found.');
	if (deposit.status === 'settled') throw new SecurityDepositError('That deposit is already settled.');
	if (deposit.status === 'voided') throw new SecurityDepositError('That deposit is already voided.');

	const [movement] = await db
		.select({ id: cashMovements.id })
		.from(cashMovements)
		.where(
			and(
				eq(cashMovements.sourceType, 'security_deposit'),
				eq(cashMovements.sourceId, securityDepositId)
			)
		)
		.limit(1);
	if (movement) {
		await voidCashMovement(hotelId, movement.id, reason, actor);
	}

	await db
		.update(securityDeposits)
		.set({
			status: 'voided',
			voidedByUserId: actor?.id ?? null,
			voidedAt: new Date(),
			voidReason: reason?.trim() || null,
			updatedAt: new Date()
		})
		.where(eq(securityDeposits.id, securityDepositId));

	await writeAudit({
		hotelId,
		actor,
		action: 'security_deposit.void',
		entityType: 'booking',
		entityId: deposit.bookingId ?? securityDepositId,
		after: { securityDepositId, reason: reason || null }
	});
}
