import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from './db/index';
import {
	bookingRooms,
	bookings,
	cashMovements,
	functionHalls,
	guests,
	hallBookings,
	hotels,
	orders,
	payments,
	roomAssignments,
	roomTypes,
	rooms,
	securityDepositPolicies,
	securityDeposits,
	type SecurityDeposit,
	type SecurityDepositPolicy
} from './db/schema/index';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';
import { ensureFolio, getFolioDetail, FolioError, type FolioTarget } from './folio';
import { getHallCloseGate, getRoomHousekeepingOverlay } from './housekeeping';
import { businessDateFor, type Tx } from './finance/shared';
import { recordCashMovement, voidCashMovement } from './finance/cash';
import { resolvePaymentAccount, type PaymentMethod } from './finance/payments';

export class SecurityDepositError extends Error {}

/** What a hold is collateral for. Same shape as `FolioTarget` on purpose: a deposit and the
 *  folio it nets against always name the same stay or event. */
export type DepositTarget = FolioTarget;

const targetMatches = (target: DepositTarget) =>
	target.kind === 'room'
		? eq(securityDeposits.bookingId, target.bookingId)
		: eq(securityDeposits.hallBookingId, target.hallBookingId);

/** How the audit trail names the thing the deposit is held against. */
const targetEntity = (target: DepositTarget) =>
	target.kind === 'room'
		? { entityType: 'booking' as const, entityId: target.bookingId }
		: { entityType: 'hall_booking' as const, entityId: target.hallBookingId };

const targetNoun = (target: DepositTarget) => (target.kind === 'room' ? 'booking' : 'event');

/** The stay/event must exist and belong to this hotel before any money is taken against it. */
async function assertTargetExists(hotelId: string, target: DepositTarget): Promise<void> {
	if (target.kind === 'room') {
		const [booking] = await db
			.select({ hotelId: bookings.hotelId })
			.from(bookings)
			.where(eq(bookings.id, target.bookingId))
			.limit(1);
		if (!booking || booking.hotelId !== hotelId) throw new SecurityDepositError('Booking not found.');
		return;
	}
	const [hall] = await db
		.select({ hotelId: orders.hotelId })
		.from(hallBookings)
		.innerJoin(orders, eq(orders.id, hallBookings.orderId))
		.where(eq(hallBookings.id, target.hallBookingId))
		.limit(1);
	if (!hall || hall.hotelId !== hotelId) throw new SecurityDepositError('Hall booking not found.');
}

export interface CollectSecurityDepositInput {
	hotelId: string;
	target: DepositTarget;
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

/** The current (most recent) deposit row for a stay or an event, or null if none was ever
 *  collected. Used by the check-in load (to decide whether to show the collect form), the
 *  checkout panel and the hall close gate (to show held/settled state). */
export async function getSecurityDepositForTarget(
	hotelId: string,
	target: DepositTarget
): Promise<SecurityDeposit | null> {
	const [row] = await db
		.select()
		.from(securityDeposits)
		.where(and(eq(securityDeposits.hotelId, hotelId), targetMatches(target)))
		.orderBy(desc(securityDeposits.createdAt))
		.limit(1);
	return row ?? null;
}

export interface SecurityDepositListRow {
	id: string;
	bookingId: string | null;
	hallBookingId: string | null;
	/** The parent booking (order) this room's or event's deposit belongs to. */
	orderId: string | null;
	/** Assigned room number(s) of the booking this deposit is held against; empty for a hall. */
	roomNumbers: string[];
	/** The hall this deposit is held against, for a function hall event. */
	hallName: string | null;
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

	const rows = await db
		.select({
			id: securityDeposits.id,
			bookingId: securityDeposits.bookingId,
			hallBookingId: securityDeposits.hallBookingId,
			orderId: sql<string | null>`coalesce(${bookings.orderId}, ${hallBookings.orderId})`,
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
			// A hall event is one day, so both ends read as its event date.
			checkIn: sql<string | null>`coalesce(${bookings.checkIn}, ${hallBookings.eventDate})`,
			checkOut: sql<string | null>`coalesce(${bookings.checkOut}, ${hallBookings.eventDate})`,
			roomTypeName: roomTypes.name,
			hallName: functionHalls.name
		})
		.from(securityDeposits)
		.leftJoin(bookings, eq(bookings.id, securityDeposits.bookingId))
		.leftJoin(hallBookings, eq(hallBookings.id, securityDeposits.hallBookingId))
		.leftJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
		.leftJoin(orders, sql`${orders.id} = coalesce(${bookings.orderId}, ${hallBookings.orderId})`)
		.leftJoin(guests, eq(guests.id, orders.guestId))
		.leftJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.leftJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
		.where(and(...conds))
		.orderBy(desc(securityDeposits.collectedAt));

	// Every deposit belongs to ONE room's booking; say which room, so a booking with several
	// rooms reads as several separate deposits.
	const bookingIds = [...new Set(rows.map((r) => r.bookingId).filter((v): v is string => !!v))];
	const numbersByBooking = new Map<string, string[]>();
	if (bookingIds.length > 0) {
		const assigned = await db
			.select({ bookingId: bookingRooms.bookingId, roomNumber: rooms.roomNumber })
			.from(roomAssignments)
			.innerJoin(bookingRooms, eq(bookingRooms.id, roomAssignments.bookingRoomId))
			.innerJoin(rooms, eq(rooms.id, roomAssignments.roomId))
			.where(inArray(bookingRooms.bookingId, bookingIds));
		for (const a of assigned) {
			const arr = numbersByBooking.get(a.bookingId) ?? [];
			arr.push(a.roomNumber);
			numbersByBooking.set(a.bookingId, arr);
		}
	}
	return rows.map((r) => ({
		...r,
		roomNumbers: r.bookingId ? (numbersByBooking.get(r.bookingId) ?? []) : []
	}));
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

	await assertTargetExists(input.hotelId, input.target);

	const existing = await getSecurityDepositForTarget(input.hotelId, input.target);
	if (existing?.status === 'held') {
		throw new SecurityDepositError(`A deposit is already held for this ${targetNoun(input.target)}.`);
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
				bookingId: input.target.kind === 'room' ? input.target.bookingId : null,
				hallBookingId: input.target.kind === 'hall' ? input.target.hallBookingId : null,
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
				memo:
					input.target.kind === 'room'
						? 'Security deposit collected at check-in'
						: 'Security deposit collected for a function hall event',
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
		...targetEntity(input.target),
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
	target: DepositTarget,
	actor: SessionUser | null,
	/** Hotel-admin-only escape hatch — the caller MUST have already checked the `hotel:admin`
	 *  capability before passing `true`. Skips the housekeeping gate below but never the
	 *  underlying money math, and is always written to the audit trail so an override is
	 *  never silent. */
	overrideHousekeepingGate = false
): Promise<{
	heldCentavos: number;
	forfeitedCentavos: number;
	refundedCentavos: number;
	remainingFolioBalanceCentavos: number;
}> {
	const deposit = await getSecurityDepositForTarget(hotelId, target);
	if (!deposit || deposit.status !== 'held') {
		throw new SecurityDepositError(`No held deposit found for this ${targetNoun(target)}.`);
	}

	// Never let the deposit settle on front desk's say-so alone — the folio's damage charges
	// only reflect what's already been reported AND resolved. If housekeeping hasn't inspected
	// the room yet, or has reported damage that isn't charged (or dismissed) yet, settling now
	// would refund in full before anyone actually checked. A hotel admin can override this one
	// gate (e.g. housekeeping is backed up and the guest can't wait) — see `overrideHousekeepingGate`.
	if (!overrideHousekeepingGate) {
		if (target.kind === 'room') {
			const assignedRooms = await db
				.select({ roomId: roomAssignments.roomId })
				.from(bookingRooms)
				.innerJoin(roomAssignments, eq(roomAssignments.bookingRoomId, bookingRooms.id))
				.where(eq(bookingRooms.bookingId, target.bookingId));
			const roomIds = [...new Set(assignedRooms.map((r) => r.roomId))];
			const overlay = roomIds.length > 0 ? await getRoomHousekeepingOverlay(hotelId, roomIds) : null;
			for (const roomId of roomIds) {
				const entry = overlay?.get(roomId);
				if (entry?.pendingDamageReports.length) {
					throw new SecurityDepositError(
						'Housekeeping has an unresolved damage report on this room — resolve it before settling the deposit.'
					);
				}
				if (entry && entry.status !== 'clean') {
					throw new SecurityDepositError(
						"Housekeeping hasn't marked this room clean yet — settle the deposit once it's inspected."
					);
				}
			}
		} else {
			// The hall's own close gate already answers both questions the room overlay does.
			const [hall] = await db
				.select({ functionHallId: hallBookings.functionHallId })
				.from(hallBookings)
				.where(eq(hallBookings.id, target.hallBookingId))
				.limit(1);
			if (!hall) throw new SecurityDepositError('Hall booking not found.');
			const gate = await getHallCloseGate(hotelId, hall.functionHallId, target.hallBookingId);
			if (gate.pendingDamageCount > 0) {
				throw new SecurityDepositError(
					'Housekeeping has an unresolved damage report on this hall — resolve it before settling the deposit.'
				);
			}
			if (gate.status !== 'clean') {
				throw new SecurityDepositError(
					"Housekeeping hasn't marked this hall clean yet — settle the deposit once it's inspected."
				);
			}
		}
	}

	let folio;
	try {
		folio = await getFolioDetail(hotelId, target);
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
			and(
				eq(payments.folioId, folio.folioId),
				eq(payments.status, 'paid'),
				isNull(payments.voidedAt),
				// The deposit's own forfeiture row is not a payment toward the damage.
				ne(payments.method, 'security_deposit')
			)
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
			const folioId = await ensureFolio(tx, hotelId, target);
			const [order] =
				target.kind === 'room'
					? await tx
							.select({ orderId: bookings.orderId })
							.from(bookings)
							.where(eq(bookings.id, target.bookingId))
							.limit(1)
					: await tx
							.select({ orderId: hallBookings.orderId })
							.from(hallBookings)
							.where(eq(hallBookings.id, target.hallBookingId))
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
				memo:
					target.kind === 'room'
						? 'Security deposit settled at checkout'
						: 'Security deposit settled at event close',
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
		...targetEntity(target),
		after: {
			securityDepositId: deposit.id,
			forfeitedCentavos,
			refundedCentavos,
			...(overrideHousekeepingGate ? { housekeepingGateOverridden: true } : {})
		}
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

/**
 * Re-checks a SETTLED deposit against the damage still on the folio, and releases whatever
 * is no longer justified back to the guest. Called after a damage charge is voided: a deposit
 * is forfeited only for damage that actually stands, so voiding the charge must undo (or shrink)
 * the forfeiture instead of leaving the guest short and the folio in credit.
 *
 * Forfeiture only ever shrinks here (voiding removes damage; it never adds any). In one
 * transaction: soft-void the old `security_deposit` payment row and the matching `other_revenue`
 * cash movement (`voidCashMovement` also posts the reversing journal entry, and lowering the
 * account balance IS the cash handed back), then — if some damage still stands — record the smaller
 * forfeiture the same way `settleSecurityDeposit` does, and update the deposit row.
 * A no-op (returns 0) when there is no settled deposit or nothing to release.
 */
export async function reconcileSettledDeposit(
	hotelId: string,
	target: DepositTarget,
	reason: string | null,
	actor: SessionUser | null
): Promise<{ releasedCentavos: number; forfeitedCentavos: number }> {
	const deposit = await getSecurityDepositForTarget(hotelId, target);
	const oldForfeited = deposit?.forfeitedCentavos ?? 0;
	if (!deposit || deposit.status !== 'settled' || oldForfeited <= 0) {
		return { releasedCentavos: 0, forfeitedCentavos: oldForfeited };
	}

	const folio = await getFolioDetail(hotelId, target);
	const baseCharges = folio.charges
		.filter((c) => c.isBaseCharge && !c.voidedAt)
		.reduce((sum, c) => sum + c.totalCentavos, 0);
	const damageCharges = folio.charges
		.filter((c) => !c.isBaseCharge && !c.voidedAt)
		.reduce((sum, c) => sum + c.totalCentavos, 0);
	const directPayments = await db
		.select({ amountCentavos: payments.amountCentavos })
		.from(payments)
		.where(
			and(
				eq(payments.folioId, folio.folioId),
				eq(payments.status, 'paid'),
				isNull(payments.voidedAt),
				ne(payments.method, 'security_deposit')
			)
		);
	const excess = Math.max(
		0,
		directPayments.reduce((sum, p) => sum + p.amountCentavos, 0) - baseCharges
	);
	const damageOwed = Math.max(0, damageCharges - excess);
	const newForfeited = Math.min(deposit.amountCentavos, damageOwed);
	if (newForfeited >= oldForfeited) return { releasedCentavos: 0, forfeitedCentavos: oldForfeited };

	const [hotel] = await db
		.select({ timezone: hotels.timezone })
		.from(hotels)
		.where(eq(hotels.id, hotelId))
		.limit(1);
	const businessDate = businessDateFor(hotel?.timezone ?? 'Asia/Manila');

	// Reverse the old forfeiture's revenue movement first: it refuses inside a locked day-close,
	// and nothing else has been touched yet if it does.
	const revenueMovements = await db
		.select({ id: cashMovements.id })
		.from(cashMovements)
		.where(
			and(
				eq(cashMovements.sourceType, 'security_deposit'),
				eq(cashMovements.sourceId, deposit.id),
				eq(cashMovements.category, 'other_revenue'),
				isNull(cashMovements.voidedAt)
			)
		);
	for (const m of revenueMovements) {
		await voidCashMovement(hotelId, m.id, reason ?? 'Damage charge voided — deposit released', actor);
	}

	await db.transaction(async (tx: Tx) => {
		await tx
			.update(payments)
			.set({
				voidedAt: new Date(),
				voidedByUserId: actor?.id ?? null,
				voidReason: reason?.trim() || 'Damage charge voided — deposit released'
			})
			.where(
				and(
					eq(payments.folioId, folio.folioId),
					eq(payments.method, 'security_deposit'),
					isNull(payments.voidedAt)
				)
			);

		if (newForfeited > 0) {
			const [order] =
				target.kind === 'room'
					? await tx
							.select({ orderId: bookings.orderId })
							.from(bookings)
							.where(eq(bookings.id, target.bookingId))
							.limit(1)
					: await tx
							.select({ orderId: hallBookings.orderId })
							.from(hallBookings)
							.where(eq(hallBookings.id, target.hallBookingId))
							.limit(1);
			if (!order) throw new SecurityDepositError('Booking not found.');
			await tx.insert(payments).values({
				orderId: order.orderId,
				provider: 'cash',
				method: 'security_deposit',
				purpose: 'settlement',
				status: 'paid',
				amountCentavos: newForfeited,
				folioId: folio.folioId,
				recordedByUserId: actor?.id ?? null,
				paidAt: new Date()
			});
			await recordCashMovement(
				{
					hotelId,
					businessDate,
					direction: 'in',
					category: 'other_revenue',
					cashAccountId: deposit.cashAccountId,
					amountCentavos: newForfeited,
					counterpartyType: 'guest',
					sourceType: 'security_deposit',
					sourceId: deposit.id,
					memo: 'Security deposit forfeited for damage (adjusted after a charge was voided)',
					actor
				},
				tx
			);
		}

		await tx
			.update(securityDeposits)
			.set({
				forfeitedCentavos: newForfeited,
				refundedCentavos: deposit.amountCentavos - newForfeited,
				updatedAt: new Date()
			})
			.where(eq(securityDeposits.id, deposit.id));
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'security_deposit.forfeiture_reduced',
		...targetEntity(target),
		after: {
			securityDepositId: deposit.id,
			previousForfeitedCentavos: oldForfeited,
			forfeitedCentavos: newForfeited,
			releasedCentavos: oldForfeited - newForfeited
		}
	});

	return { releasedCentavos: oldForfeited - newForfeited, forfeitedCentavos: newForfeited };
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
		entityType: deposit.hallBookingId ? 'hall_booking' : 'booking',
		entityId: deposit.bookingId ?? deposit.hallBookingId ?? securityDepositId,
		after: { securityDepositId, reason: reason || null }
	});
}
