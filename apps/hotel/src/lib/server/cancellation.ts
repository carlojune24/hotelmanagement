import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from './db/index';
import {
	bookings,
	bookingRooms,
	bookingStatusHistory,
	cancellationPolicies,
	folioCharges,
	folios,
	functionHalls,
	guestMessages,
	guests,
	hallBookings,
	hallBookingStatusHistory,
	hotels,
	orders,
	orderStatusHistory,
	payments,
	ratePlans,
	roomTypes
} from './db/schema/index';
import { writeAudit } from './audit';
import { expireCheckoutSession } from './paymongo/checkout';
import { ensureFolio, getOrderIdForTarget, type FolioTarget } from './folio';
import { recordCashMovement } from './finance/cash';
import { resolvePaymentAccount, type PaymentMethod } from './finance/payments';
import { businessDateFor, FinanceError } from './finance/shared';
import { getPaymongoRefundableCentavos, refundOrderViaPaymongo } from './paymongo-refund';
import type { SessionUser } from './auth/session';
import { nightsBetween } from './pricing';

export class CancellationError extends Error {}

/** Refund tenders a cancellation payout may be issued as (a subset of `payment_method`),
 *  plus `paymongo` — a real refund back to the guest's original online payment method via
 *  PayMongo's Refunds API, only offered when `CancellationQuote.paymongoRefundableCentavos`
 *  covers the amount. */
export const REFUND_METHODS = ['cash', 'gcash', 'maya', 'bank_transfer', 'card', 'paymongo'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

type PenaltyType = typeof cancellationPolicies.$inferSelect.penaltyType;

export interface CancellationPolicyView {
	name: string;
	freeCancelHours: number | null;
	penaltyType: PenaltyType;
	penaltyValueBps: number | null;
}

export interface CancellationFeeInput {
	/** The rate plan's attached policy, or null when none is set (or a hall — halls carry no policy). */
	policy: CancellationPolicyView | null;
	lineTotalCentavos: number;
	/** What the guest has actually paid toward this line (0 for an unpaid `pending_payment` line). */
	paidCentavos: number;
	nights: number;
	/** Whole hours between "now" and the check-in moment; negative once check-in has passed. */
	hoursUntilCheckIn: number;
}

export interface CancellationFeeResult {
	/** True when the policy's free-cancellation window is still open — fee is 0. */
	freeCancellation: boolean;
	/** Suggested fee, already clamped to `[0, paidCentavos]`. */
	feeCentavos: number;
	/** `paidCentavos - feeCentavos`. */
	refundCentavos: number;
	/** One-line, plain-language description of the policy in effect. */
	policyLabel: string;
	/** How the suggested fee was derived. */
	basisLabel: string;
}

function penaltyBasis(type: PenaltyType, valueBps: number | null): string {
	switch (type) {
		case 'full_amount':
			return 'Penalty: the full booking total';
		case 'first_night':
			return 'Penalty: the first night';
		case 'percentage_of_total':
			return `Penalty: ${((valueBps ?? 0) / 100).toFixed(valueBps && valueBps % 100 ? 2 : 0)}% of the booking total`;
	}
}

/**
 * Pure suggested-fee calculation for a cancellation. The front desk can still override
 * the returned `feeCentavos` in the confirm step — this is the prefilled default, not a
 * hard rule. The fee is always clamped to what was actually paid (this flow never turns
 * a cancellation into a receivable), so `refundCentavos` is never negative.
 */
export function computeCancellationFee(input: CancellationFeeInput): CancellationFeeResult {
	const { policy, lineTotalCentavos, paidCentavos, nights, hoursUntilCheckIn } = input;
	const cap = Math.max(0, paidCentavos);

	if (!policy) {
		return {
			freeCancellation: false,
			feeCentavos: 0,
			refundCentavos: cap,
			policyLabel: 'No cancellation policy is attached to this rate — set the fee manually.',
			basisLabel: 'No policy on file'
		};
	}

	const freeWindow = policy.freeCancelHours != null && hoursUntilCheckIn >= policy.freeCancelHours;
	const windowLabel =
		policy.freeCancelHours == null
			? `${policy.name} — no free-cancellation window`
			: freeWindow
				? `${policy.name} — free until ${policy.freeCancelHours}h before check-in (still open)`
				: `${policy.name} — free-cancellation window (${policy.freeCancelHours}h before check-in) has passed`;

	if (freeWindow) {
		return {
			freeCancellation: true,
			feeCentavos: 0,
			refundCentavos: cap,
			policyLabel: windowLabel,
			basisLabel: 'Inside the free-cancellation window'
		};
	}

	let raw: number;
	switch (policy.penaltyType) {
		case 'full_amount':
			raw = lineTotalCentavos;
			break;
		case 'first_night':
			raw = nights > 0 ? Math.round(lineTotalCentavos / nights) : lineTotalCentavos;
			break;
		case 'percentage_of_total':
			raw = Math.round((lineTotalCentavos * (policy.penaltyValueBps ?? 0)) / 10000);
			break;
	}

	const feeCentavos = Math.min(cap, Math.max(0, raw));
	return {
		freeCancellation: false,
		feeCentavos,
		refundCentavos: cap - feeCentavos,
		policyLabel: windowLabel,
		basisLabel: penaltyBasis(policy.penaltyType, policy.penaltyValueBps)
	};
}

/** Convert a wall-clock `date` + `time` in `timeZone` to a UTC epoch (ms). PH has no DST;
 *  a single offset pass is exact there and close enough everywhere else this app runs. */
function wallTimeToUtcMs(dateStr: string, timeStr: string, timeZone: string): number {
	const [y, mo, d] = dateStr.split('-').map(Number);
	const [h, mi, s] = timeStr.split(':').map((n) => Number(n) || 0);
	const guess = Date.UTC(y!, mo! - 1, d!, h!, mi!, s!);
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	}).formatToParts(new Date(guess));
	const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
	const hour = get('hour') % 24;
	const asWall = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		hour,
		get('minute'),
		get('second')
	);
	return guess - (asWall - guess);
}

export interface CancellationQuote {
	kind: 'room' | 'hall';
	id: string;
	orderId: string;
	guestName: string;
	lineLabel: string;
	dateLabel: string;
	/** Booking/hall status right now — the confirm action re-checks this. */
	status: string;
	orderStatus: string;
	lineTotalCentavos: number;
	paidCentavos: number;
	/** How much of `paidCentavos` could be refunded back through PayMongo (vs. manually
	 *  recorded) — 0 when nothing was paid online, or the online portion is smaller than
	 *  the total paid (mixed cash + online). */
	paymongoRefundableCentavos: number;
	nights: number;
	fee: CancellationFeeResult;
}

async function paidCentavosForOrder(orderId: string): Promise<number> {
	const rows = await db
		.select({ amountCentavos: payments.amountCentavos })
		.from(payments)
		.where(and(eq(payments.orderId, orderId), eq(payments.status, 'paid'), isNull(payments.voidedAt)));
	return rows.reduce((sum, r) => sum + r.amountCentavos, 0);
}

/** Everything the cancel dialog needs: the line, the policy in effect, and the suggested fee/refund. */
export async function getCancellationQuote(
	hotelId: string,
	target: FolioTarget
): Promise<CancellationQuote | null> {
	const [hotel] = await db
		.select({ timezone: hotels.timezone, checkInTime: hotels.checkInTime })
		.from(hotels)
		.where(eq(hotels.id, hotelId))
		.limit(1);
	if (!hotel) return null;
	const now = Date.now();

	if (target.kind === 'room') {
		const [row] = await db
			.select({
				booking: bookings,
				order: orders,
				guestName: guests.fullName,
				roomTypeName: roomTypes.name,
				policy: cancellationPolicies
			})
			.from(bookings)
			.innerJoin(orders, eq(orders.id, bookings.orderId))
			.innerJoin(guests, eq(guests.id, orders.guestId))
			.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
			.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
			.innerJoin(ratePlans, eq(ratePlans.id, bookingRooms.ratePlanId))
			.leftJoin(cancellationPolicies, eq(cancellationPolicies.id, ratePlans.cancellationPolicyId))
			.where(and(eq(bookings.id, target.bookingId), eq(bookings.hotelId, hotelId)))
			.limit(1);
		if (!row) return null;

		const nights = nightsBetween(row.booking.checkIn, row.booking.checkOut).length;
		const paid = row.order.status === 'confirmed' ? await paidCentavosForOrder(row.order.id) : 0;
		const paymongoRefundable =
			paid > 0 ? await getPaymongoRefundableCentavos(hotelId, row.order.id) : 0;
		const hoursUntilCheckIn =
			(wallTimeToUtcMs(row.booking.checkIn, hotel.checkInTime, hotel.timezone) - now) / 3_600_000;

		const fee = computeCancellationFee({
			policy: row.policy
				? {
						name: row.policy.name,
						freeCancelHours: row.policy.freeCancelHours,
						penaltyType: row.policy.penaltyType,
						penaltyValueBps: row.policy.penaltyValueBps
					}
				: null,
			lineTotalCentavos: row.booking.totalCentavos,
			paidCentavos: paid,
			nights,
			hoursUntilCheckIn
		});

		return {
			kind: 'room',
			id: row.booking.id,
			orderId: row.order.id,
			guestName: row.guestName,
			lineLabel: row.roomTypeName,
			dateLabel: `${row.booking.checkIn} → ${row.booking.checkOut} · ${nights} night${nights === 1 ? '' : 's'}`,
			status: row.booking.status,
			orderStatus: row.order.status,
			lineTotalCentavos: row.booking.totalCentavos,
			paidCentavos: paid,
			paymongoRefundableCentavos: paymongoRefundable,
			nights,
			fee
		};
	}

	const [row] = await db
		.select({
			hallBooking: hallBookings,
			order: orders,
			guestName: guests.fullName,
			hallName: functionHalls.name
		})
		.from(hallBookings)
		.innerJoin(orders, eq(orders.id, hallBookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
		.where(and(eq(hallBookings.id, target.hallBookingId), eq(orders.hotelId, hotelId)))
		.limit(1);
	if (!row) return null;

	const paid = row.order.status === 'confirmed' ? await paidCentavosForOrder(row.order.id) : 0;
	const paymongoRefundable = paid > 0 ? await getPaymongoRefundableCentavos(hotelId, row.order.id) : 0;
	const hoursUntilCheckIn =
		(wallTimeToUtcMs(row.hallBooking.eventDate, row.hallBooking.startTime, hotel.timezone) - now) /
		3_600_000;

	// Halls carry no cancellation policy — the fee is staff discretion, prefilled at 0.
	const fee = computeCancellationFee({
		policy: null,
		lineTotalCentavos: row.hallBooking.totalCentavos,
		paidCentavos: paid,
		nights: 1,
		hoursUntilCheckIn
	});

	return {
		kind: 'hall',
		id: row.hallBooking.id,
		orderId: row.order.id,
		guestName: row.guestName,
		lineLabel: `${row.hallName} · ${row.hallBooking.eventType}`,
		dateLabel: `${row.hallBooking.eventDate} · ${row.hallBooking.startTime.slice(0, 5)}–${row.hallBooking.endTime.slice(0, 5)}`,
		status: row.hallBooking.status,
		orderStatus: row.order.status,
		lineTotalCentavos: row.hallBooking.totalCentavos,
		paidCentavos: paid,
		paymongoRefundableCentavos: paymongoRefundable,
		nights: 1,
		fee
	};
}

export interface CancelBookingInput {
	hotelId: string;
	target: FolioTarget;
	/** Staff-confirmed fee (may differ from the computed suggestion). Clamped to `[0, paid]`. */
	feeCentavos: number;
	refundMethod: RefundMethod;
	reason: string;
	actor: SessionUser | null;
}

export interface CancelBookingResult {
	orderId: string;
	orderCancelled: boolean;
	feeCentavos: number;
	refundCentavos: number;
	refundPaymentId: string | null;
}

/**
 * Cancels a single confirmed / pending booking line (room or hall). Flips the line to
 * `cancelled` (releasing its inventory hold, which is implicit — a cancelled line leaves
 * `ACTIVE_BOOKING_STATUSES`), cancels the parent order too once no live line remains, and
 * for a paid line settles the money: a negative folio adjustment brings the folio back to
 * zero and a `refund` payment + `cash_movements` out row pays the guest back the balance
 * after the retained cancellation fee. An unpaid (`pending_payment`) line just flips status
 * and best-effort-expires its PayMongo checkout session.
 */
export async function cancelBooking(input: CancelBookingInput): Promise<CancelBookingResult> {
	const { hotelId, target, refundMethod, actor } = input;
	const reason = input.reason.trim();
	if (!reason) throw new CancellationError('Enter a reason for the cancellation.');

	const isRoom = target.kind === 'room';
	const lineId = isRoom ? target.bookingId : target.hallBookingId;
	const lockKey = isRoom ? `booking:${lineId}` : `hall:${lineId}`;

	const orderId = await getOrderIdForTarget(target);
	if (!orderId) throw new CancellationError('Booking not found.');

	const [hotel] = await db
		.select({ timezone: hotels.timezone })
		.from(hotels)
		.where(eq(hotels.id, hotelId))
		.limit(1);
	const businessDate = businessDateFor(hotel?.timezone ?? 'Asia/Manila');

	// A real PayMongo refund is an external, hard-to-reverse action — it must happen
	// *before* the transaction below (never hold row locks across a network call), and
	// the booking must never be flipped to cancelled claiming a refund that didn't
	// actually happen. Pre-compute the same way the transaction would, refund it for
	// real, then use the amount PayMongo actually moved (not a fresh recompute) as the
	// authoritative figure once inside the transaction.
	let paymongoRefund: { refundedCentavos: number; refundPaymentIds: string[] } | null = null;
	if (refundMethod === 'paymongo') {
		const [orderRow] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1);
		if (!orderRow) throw new CancellationError('Booking not found.');
		if (orderRow.status === 'confirmed') {
			const lineTotalCentavos = isRoom
				? (
						await db
							.select({ v: bookings.totalCentavos })
							.from(bookings)
							.where(eq(bookings.id, target.bookingId))
							.limit(1)
					)[0]?.v
				: (
						await db
							.select({ v: hallBookings.totalCentavos })
							.from(hallBookings)
							.where(eq(hallBookings.id, target.hallBookingId))
							.limit(1)
					)[0]?.v;
			if (lineTotalCentavos == null) throw new CancellationError('Booking not found.');

			const paidNow = await paidCentavosForOrder(orderId);
			const feeNow = Math.min(Math.max(0, Math.round(input.feeCentavos)), Math.max(0, paidNow));
			const refundNow = Math.max(0, Math.min(paidNow, lineTotalCentavos) - feeNow);

			if (refundNow > 0) {
				try {
					paymongoRefund = await refundOrderViaPaymongo({
						hotelId,
						orderId,
						amountCentavos: refundNow,
						notes: reason,
						actor
					});
				} catch (e) {
					if (e instanceof FinanceError) throw new CancellationError(e.message);
					throw e;
				}
			}
		}
	}

	let result: {
		orderId: string;
		orderCancelled: boolean;
		feeCentavos: number;
		refundCentavos: number;
		refundPaymentId: string | null;
		pendingSessionId: string | null;
	};

	try {
		result = await db.transaction(async (tx) => {
			await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${hotelId}), hashtext(${lockKey}))`);

			const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
			if (!order || order.hotelId !== hotelId) throw new CancellationError('Booking not found.');

			let lineTotalCentavos: number;
			let fromStatus: 'confirmed' | 'pending_payment';

			if (isRoom) {
				const [booking] = await tx
					.select()
					.from(bookings)
					.where(eq(bookings.id, target.bookingId))
					.limit(1);
				if (!booking || booking.hotelId !== hotelId)
					throw new CancellationError('Booking not found.');
				if (booking.status !== 'confirmed' && booking.status !== 'pending_payment') {
					throw new CancellationError(
						`A ${booking.status.replace(/_/g, ' ')} booking can't be cancelled here.`
					);
				}
				fromStatus = booking.status;
				lineTotalCentavos = booking.totalCentavos;

				const flipped = await tx
					.update(bookings)
					.set({ status: 'cancelled', updatedAt: new Date() })
					.where(and(eq(bookings.id, booking.id), eq(bookings.status, booking.status)))
					.returning({ id: bookings.id });
				if (flipped.length === 0) {
					throw new CancellationError('This booking just changed — reload and try again.');
				}
			} else {
				const [hb] = await tx
					.select()
					.from(hallBookings)
					.where(eq(hallBookings.id, target.hallBookingId))
					.limit(1);
				if (!hb) throw new CancellationError('Booking not found.');
				if (hb.status !== 'confirmed' && hb.status !== 'pending_payment') {
					throw new CancellationError(
						`A ${hb.status.replace(/_/g, ' ')} event can't be cancelled here.`
					);
				}
				fromStatus = hb.status;
				lineTotalCentavos = hb.totalCentavos;

				const flipped = await tx
					.update(hallBookings)
					.set({ status: 'cancelled' })
					.where(and(eq(hallBookings.id, hb.id), eq(hallBookings.status, hb.status)))
					.returning({ id: hallBookings.id });
				if (flipped.length === 0) {
					throw new CancellationError('This event just changed — reload and try again.');
				}
			}

			// Money — only for a paid line.
			let feeCentavos = 0;
			let refundCentavos = 0;
			let refundPaymentId: string | null = null;

			if (order.status === 'confirmed') {
				const paid = await paidCentavosForOrder(orderId);
				feeCentavos = Math.min(Math.max(0, Math.round(input.feeCentavos)), Math.max(0, paid));

				if (refundMethod === 'paymongo') {
					// Real money already moved via PayMongo before this transaction started —
					// use what actually happened, not a fresh recompute, as authoritative.
					refundCentavos = paymongoRefund?.refundedCentavos ?? 0;
					refundPaymentId = paymongoRefund?.refundPaymentIds[0] ?? null;

					if (refundCentavos > 0) {
						const folioId = await ensureFolio(tx, hotelId, target);
						// Bring the folio back to zero: it was seeded at the line total and fully
						// paid; after the retained fee the "real" charge is `fee`, so credit back
						// the difference. The refund payment row itself was already written by
						// `refundOrderViaPaymongo` (possibly split across several origin payments).
						await tx.insert(folioCharges).values({
							folioId,
							description: `Cancellation — ${reason.slice(0, 120)}`,
							quantity: 1,
							unitPriceCentavos: -refundCentavos,
							taxCentavos: 0,
							totalCentavos: -refundCentavos,
							addedByUserId: actor?.id ?? null
						});
					}
				} else {
					refundCentavos = Math.max(0, Math.min(paid, lineTotalCentavos) - feeCentavos);

					if (refundCentavos > 0) {
						const { cashAccountId, shiftId } = await resolvePaymentAccount(
							hotelId,
							refundMethod as PaymentMethod
						);
						const folioId = await ensureFolio(tx, hotelId, target);

						// Bring the folio back to zero: it was seeded at the line total and fully paid;
						// after the retained fee the "real" charge is `fee`, so credit back the difference.
						await tx.insert(folioCharges).values({
							folioId,
							description: `Cancellation — ${reason.slice(0, 120)}`,
							quantity: 1,
							unitPriceCentavos: -refundCentavos,
							taxCentavos: 0,
							totalCentavos: -refundCentavos,
							addedByUserId: actor?.id ?? null
						});

						const [refundRow] = await tx
							.insert(payments)
							.values({
								orderId,
								provider: 'cash',
								method: refundMethod as PaymentMethod,
								purpose: 'refund',
								status: 'paid',
								amountCentavos: -refundCentavos,
								folioId,
								cashAccountId,
								shiftId: shiftId ?? null,
								recordedByUserId: actor?.id ?? null,
								paidAt: new Date()
							})
							.returning({ id: payments.id });
						refundPaymentId = refundRow!.id;

						await recordCashMovement(
							{
								hotelId,
								businessDate,
								direction: 'out',
								category: 'refund',
								cashAccountId,
								amountCentavos: refundCentavos,
								counterpartyType: 'guest',
								sourceType: 'payment',
								sourceId: refundRow!.id,
								paymentId: refundRow!.id,
								shiftId: shiftId ?? null,
								memo: `Cancellation refund — ${target.kind} booking`,
								actor
							},
							tx
						);
					}
				}
			}

			// Auto-resolve any open guest-filed cancellation request for this exact line —
			// this is the one place `guest_messages` learns a request was actually acted
			// on, regardless of whether staff cancelled it from that request or independently.
			await tx
				.update(guestMessages)
				.set({ status: 'actioned', resolvedByUserId: actor?.id ?? null, resolvedAt: new Date() })
				.where(
					and(
						eq(guestMessages.kind, 'cancellation_request'),
						eq(guestMessages.status, 'open'),
						isRoom
							? eq(guestMessages.bookingId, target.bookingId)
							: eq(guestMessages.hallBookingId, target.hallBookingId)
					)
				);

			// History rows.
			const noteParts = [`Cancelled — ${reason}`];
			if (feeCentavos > 0) noteParts.push(`fee ₱${(feeCentavos / 100).toFixed(2)} retained`);
			if (refundCentavos > 0)
				noteParts.push(
					`₱${(refundCentavos / 100).toFixed(2)} refunded (${
						refundMethod === 'paymongo' ? 'PayMongo' : refundMethod.replace(/_/g, ' ')
					})`
				);
			const note = noteParts.join('; ');

			if (isRoom) {
				await tx.insert(bookingStatusHistory).values({
					bookingId: target.bookingId,
					fromStatus,
					toStatus: 'cancelled',
					note
				});
			} else {
				await tx.insert(hallBookingStatusHistory).values({
					hallBookingId: target.hallBookingId,
					fromStatus,
					toStatus: 'cancelled',
					note
				});
			}

			// Close the line's folio so it stops reading as an open balance anywhere.
			await tx
				.update(folios)
				.set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() })
				.where(
					and(
						eq(folios.hotelId, hotelId),
						isRoom
							? eq(folios.bookingId, target.bookingId)
							: eq(folios.hallBookingId, target.hallBookingId)
					)
				);

			// Cancel the parent order once nothing live remains under it.
			const [liveRoom] = await tx
				.select({ id: bookings.id })
				.from(bookings)
				.where(
					and(
						eq(bookings.orderId, orderId),
						ne(bookings.status, 'cancelled'),
						ne(bookings.status, 'no_show')
					)
				)
				.limit(1);
			const [liveHall] = await tx
				.select({ id: hallBookings.id })
				.from(hallBookings)
				.where(and(eq(hallBookings.orderId, orderId), ne(hallBookings.status, 'cancelled')))
				.limit(1);

			let orderCancelled = false;
			if (!liveRoom && !liveHall && order.status !== 'cancelled') {
				await tx
					.update(orders)
					.set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
					.where(eq(orders.id, orderId));
				await tx.insert(orderStatusHistory).values({
					orderId,
					fromStatus: order.status,
					toStatus: 'cancelled',
					note: `All lines cancelled — ${reason}`
				});
				orderCancelled = true;
			}

			return {
				orderId,
				orderCancelled,
				feeCentavos,
				refundCentavos,
				refundPaymentId,
				pendingSessionId:
					order.status === 'pending_payment' ? order.paymongoCheckoutSessionId : null
			};
		});
	} catch (e) {
		if (e instanceof FinanceError) throw new CancellationError(e.message);
		throw e;
	}

	// Best-effort: kill an abandoned checkout so a late payment can't land on a cancelled hold.
	if (result.pendingSessionId) {
		try {
			await expireCheckoutSession(result.pendingSessionId);
		} catch (e) {
			console.error('cancelBooking: could not expire checkout session', orderId, e);
		}
	}

	await writeAudit({
		hotelId,
		actor,
		action: isRoom ? 'booking.cancel' : 'hall_booking.cancel',
		entityType: isRoom ? 'booking' : 'hall_booking',
		entityId: lineId,
		after: {
			reason,
			feeCentavos: result.feeCentavos,
			refundCentavos: result.refundCentavos,
			refundMethod,
			orderCancelled: result.orderCancelled
		}
	});

	return {
		orderId: result.orderId,
		orderCancelled: result.orderCancelled,
		feeCentavos: result.feeCentavos,
		refundCentavos: result.refundCentavos,
		refundPaymentId: result.refundPaymentId
	};
}

/** Marks a confirmed arrival that never showed up as `no_show`. Releases the room hold
 *  (implicit — `no_show` leaves `ACTIVE_BOOKING_STATUSES`); does not move any money. */
export async function markNoShow(
	hotelId: string,
	bookingId: string,
	actor: SessionUser | null
): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${hotelId}), hashtext(${'booking:' + bookingId}))`
		);
		const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
		if (!booking || booking.hotelId !== hotelId) throw new CancellationError('Booking not found.');
		if (booking.status !== 'confirmed') {
			throw new CancellationError('Only a confirmed arrival can be marked no-show.');
		}
		const flipped = await tx
			.update(bookings)
			.set({ status: 'no_show', updatedAt: new Date() })
			.where(and(eq(bookings.id, bookingId), eq(bookings.status, 'confirmed')))
			.returning({ id: bookings.id });
		if (flipped.length === 0) {
			throw new CancellationError('This booking just changed — reload and try again.');
		}
		await tx.insert(bookingStatusHistory).values({
			bookingId,
			fromStatus: 'confirmed',
			toStatus: 'no_show',
			note: 'No-show — marked by front desk. Payment (if any) kept; refund separately if your policy requires it.'
		});
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'booking.no_show',
		entityType: 'booking',
		entityId: bookingId
	});
}
