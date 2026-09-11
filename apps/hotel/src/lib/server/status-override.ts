import { and, count, desc, eq, gt, inArray, isNull, lt, ne } from 'drizzle-orm';
import { db } from './db/index';
import {
	bookingRooms,
	bookings,
	bookingStatusHistory,
	folioCharges,
	folios,
	hallBookings,
	hallBookingStatusHistory,
	orders,
	orderStatusHistory,
	payments,
	rooms
} from './db/schema/index';
import { writeAudit } from './audit';
import { ACTIVE_BOOKING_STATUSES } from './availability';
import { checkHallAvailability } from './hall-availability';
import { getOrderIdForTarget, voidFolioCharge, type FolioTarget } from './folio';
import { recordPayment, voidPayment, type PaymentMethod } from './finance/payments';
import { sendBookingConfirmation } from './email/send-booking-confirmation';
import type { SessionUser } from './auth/session';

export class StatusOverrideError extends Error {}

/**
 * Admin-only escape hatch for a booking whose status is wrong or stuck. Deliberately
 * narrow — NOT a generic "set to any status" tool. Check-in/check-out are excluded
 * entirely (they need a physical room picked and `room_assignments` date-capping that
 * can't be safely automated here), and every money-moving step below delegates to the
 * same standalone, already-tested helpers the rest of the app uses (`recordPayment`,
 * `voidPayment`, `voidFolioCharge`) rather than reinventing cash/folio logic. Those
 * helpers each manage their own transaction, so this file calls them as a sequence of
 * steps rather than nesting them inside one giant transaction — the same shape
 * `checkOutBooking`'s post-commit invoice issuance already uses elsewhere.
 */

/**
 * Confirms a `pending_payment` order by hand — for a guest who paid outside PayMongo
 * (bank transfer, cash on file, a missed/failed webhook). Records a real payment
 * against every still-pending line under the order (so folio math never lies about
 * what was actually collected), then flips every line and the order itself to
 * `confirmed` in one tight transaction. Payments are recorded *before* the status
 * flip: if one line's payment fails (e.g. no default bank account configured),
 * nothing has been confirmed yet and the operation can simply be retried once fixed.
 */
export async function manuallyConfirmOrder(input: {
	hotelId: string;
	orderId: string;
	method: PaymentMethod;
	referenceNo?: string | null;
	reason: string;
	actor: SessionUser | null;
}): Promise<void> {
	const reason = input.reason.trim();
	if (!reason) throw new StatusOverrideError('Enter a reason for the manual confirmation.');

	const [order] = await db
		.select()
		.from(orders)
		.where(and(eq(orders.id, input.orderId), eq(orders.hotelId, input.hotelId)))
		.limit(1);
	if (!order) throw new StatusOverrideError('Order not found.');
	if (order.status !== 'pending_payment') {
		throw new StatusOverrideError('This order is not pending payment.');
	}

	const pendingRooms = await db
		.select()
		.from(bookings)
		.where(and(eq(bookings.orderId, order.id), eq(bookings.status, 'pending_payment')));
	const pendingHalls = await db
		.select()
		.from(hallBookings)
		.where(and(eq(hallBookings.orderId, order.id), eq(hallBookings.status, 'pending_payment')));
	if (pendingRooms.length === 0 && pendingHalls.length === 0) {
		throw new StatusOverrideError('Nothing on this order is still pending payment.');
	}

	try {
		for (const b of pendingRooms) {
			await recordPayment({
				hotelId: input.hotelId,
				target: { kind: 'room', bookingId: b.id },
				method: input.method,
				amountCentavos: b.totalCentavos,
				purpose: 'settlement',
				referenceNo: input.referenceNo,
				actor: input.actor
			});
		}
		for (const h of pendingHalls) {
			await recordPayment({
				hotelId: input.hotelId,
				target: { kind: 'hall', hallBookingId: h.id },
				method: input.method,
				amountCentavos: h.totalCentavos,
				purpose: 'settlement',
				referenceNo: input.referenceNo,
				actor: input.actor
			});
		}
	} catch (e) {
		if (e instanceof Error) throw new StatusOverrideError(e.message);
		throw e;
	}

	await db.transaction(async (tx) => {
		for (const b of pendingRooms) {
			const flipped = await tx
				.update(bookings)
				.set({ status: 'confirmed', updatedAt: new Date() })
				.where(and(eq(bookings.id, b.id), eq(bookings.status, 'pending_payment')))
				.returning({ id: bookings.id });
			if (flipped.length === 0) {
				throw new StatusOverrideError('A booking changed underneath this — reload and try again.');
			}
			await tx.insert(bookingStatusHistory).values({
				bookingId: b.id,
				fromStatus: 'pending_payment',
				toStatus: 'confirmed',
				note: `[Override] Manually confirmed — ${reason}`
			});
		}
		for (const h of pendingHalls) {
			const flipped = await tx
				.update(hallBookings)
				.set({ status: 'confirmed' })
				.where(and(eq(hallBookings.id, h.id), eq(hallBookings.status, 'pending_payment')))
				.returning({ id: hallBookings.id });
			if (flipped.length === 0) {
				throw new StatusOverrideError('A hall booking changed underneath this — reload and try again.');
			}
			await tx.insert(hallBookingStatusHistory).values({
				hallBookingId: h.id,
				fromStatus: 'pending_payment',
				toStatus: 'confirmed',
				note: `[Override] Manually confirmed — ${reason}`
			});
		}
		const flippedOrder = await tx
			.update(orders)
			.set({ status: 'confirmed', updatedAt: new Date() })
			.where(and(eq(orders.id, order.id), eq(orders.status, 'pending_payment')))
			.returning({ id: orders.id });
		if (flippedOrder.length === 0) {
			throw new StatusOverrideError('This order changed underneath this — reload and try again.');
		}
		await tx.insert(orderStatusHistory).values({
			orderId: order.id,
			fromStatus: 'pending_payment',
			toStatus: 'confirmed',
			note: `[Override] Manually confirmed — ${reason}`
		});
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'order.manual_confirm',
		entityType: 'order',
		entityId: order.id,
		after: { reason, method: input.method, referenceNo: input.referenceNo ?? null }
	});

	void sendBookingConfirmation(order.id).catch((e) =>
		console.error('manuallyConfirmOrder: sendBookingConfirmation failed', order.id, e)
	);
}

/** Whether this order was ever genuinely paid — a real, non-voided settlement/deposit/
 *  balance payment on file — independent of whether a refund happened to be recorded
 *  (a 100%-fee cancellation legitimately records neither a refund payment nor a folio
 *  adjustment, since there was nothing to credit back). This is what decides whether a
 *  reinstated line goes back to `confirmed` or `pending_payment`. */
async function orderWasEverPaid(orderId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: payments.id })
		.from(payments)
		.where(
			and(
				eq(payments.orderId, orderId),
				eq(payments.status, 'paid'),
				ne(payments.purpose, 'refund'),
				isNull(payments.voidedAt)
			)
		)
		.limit(1);
	return Boolean(row);
}

/**
 * Reinstates a wrongly cancelled/no-showed booking. Re-checks the room type (or hall
 * slot) is still actually free before touching anything — this never forces a
 * double-booking. If the cancellation paid out a refund, that refund (and its matching
 * fee-adjustment folio charge) is voided via the same standalone helpers the Finance
 * module already uses (`voidPayment` also reverses the linked cash movement), so a
 * reinstated booking's folio balance reads exactly as it did before it was cancelled.
 */
export async function reinstateBooking(input: {
	hotelId: string;
	target: FolioTarget;
	reason: string;
	actor: SessionUser | null;
}): Promise<{ reinstatedTo: 'confirmed' | 'pending_payment'; refundReversed: boolean }> {
	const reason = input.reason.trim();
	if (!reason) throw new StatusOverrideError('Enter a reason for reinstating this booking.');
	const target = input.target;
	const lineId = target.kind === 'room' ? target.bookingId : target.hallBookingId;

	let fromStatus: 'cancelled' | 'no_show';

	if (target.kind === 'room') {
		const [booking] = await db
			.select()
			.from(bookings)
			.where(and(eq(bookings.id, target.bookingId), eq(bookings.hotelId, input.hotelId)))
			.limit(1);
		if (!booking) throw new StatusOverrideError('Booking not found.');
		if (booking.status !== 'cancelled' && booking.status !== 'no_show') {
			throw new StatusOverrideError(
				`A ${booking.status.replace(/_/g, ' ')} booking can't be reinstated.`
			);
		}
		fromStatus = booking.status;
		const { checkIn, checkOut } = booking;

		const [br] = await db
			.select()
			.from(bookingRooms)
			.where(eq(bookingRooms.bookingId, booking.id))
			.limit(1);
		if (!br) throw new StatusOverrideError('This booking has no room-type line to reinstate.');
		const { roomTypeId, quantity } = br;

		// Same overlap math `searchAvailability` uses: active rooms of this type minus
		// rooms already held by an overlapping ACTIVE_BOOKING_STATUSES booking. This
		// booking itself doesn't count (it's currently cancelled/no_show, outside that list).
		const [totalRow] = await db
			.select({ n: count() })
			.from(rooms)
			.where(
				and(
					eq(rooms.hotelId, input.hotelId),
					eq(rooms.roomTypeId, roomTypeId),
					eq(rooms.isActive, true),
					eq(rooms.operationalStatus, 'available')
				)
			);
		const totalRooms = totalRow?.n ?? 0;
		const bookedRows = await db
			.select({ quantity: bookingRooms.quantity })
			.from(bookingRooms)
			.innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
			.where(
				and(
					eq(bookingRooms.roomTypeId, roomTypeId),
					inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
					lt(bookings.checkIn, checkOut),
					gt(bookings.checkOut, checkIn)
				)
			);
		const booked = bookedRows.reduce((sum, r) => sum + r.quantity, 0);
		if (totalRooms - booked < quantity) {
			throw new StatusOverrideError('No rooms of this type are free for these dates anymore.');
		}
	} else {
		const [hb] = await db
			.select({ hb: hallBookings })
			.from(hallBookings)
			.innerJoin(orders, eq(orders.id, hallBookings.orderId))
			.where(and(eq(hallBookings.id, target.hallBookingId), eq(orders.hotelId, input.hotelId)))
			.limit(1)
			.then((rows) => rows.map((r) => r.hb));
		if (!hb) throw new StatusOverrideError('Booking not found.');
		if (hb.status !== 'cancelled') {
			throw new StatusOverrideError(`A ${hb.status.replace(/_/g, ' ')} event can't be reinstated.`);
		}
		fromStatus = 'cancelled';
		const stillFree = await checkHallAvailability({
			hotelId: input.hotelId,
			functionHallId: hb.functionHallId,
			eventDate: hb.eventDate,
			startTime: hb.startTime,
			endTime: hb.endTime
		});
		if (!stillFree) throw new StatusOverrideError('This hall is no longer free for that date/time.');
	}

	const orderId = await getOrderIdForTarget(target);
	if (!orderId) throw new StatusOverrideError('Booking not found.');
	const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
	if (!order) throw new StatusOverrideError('Order not found.');

	const wasPaid = await orderWasEverPaid(orderId);
	const targetStatus: 'confirmed' | 'pending_payment' = wasPaid ? 'confirmed' : 'pending_payment';

	// Reverse a real refund, if one was ever paid out for this line's folio.
	let refundReversed = false;
	const [folio] = await db
		.select()
		.from(folios)
		.where(target.kind === 'room' ? eq(folios.bookingId, target.bookingId) : eq(folios.hallBookingId, target.hallBookingId))
		.limit(1);
	if (folio) {
		const [refundPayment] = await db
			.select()
			.from(payments)
			.where(and(eq(payments.folioId, folio.id), eq(payments.purpose, 'refund'), isNull(payments.voidedAt)))
			.limit(1);
		if (refundPayment) {
			await voidPayment(input.hotelId, refundPayment.id, reason, input.actor);
			refundReversed = true;

			const [feeCharge] = await db
				.select()
				.from(folioCharges)
				.where(
					and(
						eq(folioCharges.folioId, folio.id),
						eq(folioCharges.isBaseCharge, false),
						isNull(folioCharges.voidedAt),
						lt(folioCharges.totalCentavos, 0)
					)
				)
				.orderBy(desc(folioCharges.createdAt))
				.limit(1);
			if (feeCharge) {
				await voidFolioCharge(input.hotelId, target, feeCharge.id, reason, input.actor);
			}
		}
	}

	await db.transaction(async (tx) => {
		if (folio && folio.status === 'closed') {
			await tx
				.update(folios)
				.set({ status: 'open', closedAt: null, updatedAt: new Date() })
				.where(eq(folios.id, folio.id));
		}

		if (target.kind === 'room') {
			const flipped = await tx
				.update(bookings)
				.set({ status: targetStatus, updatedAt: new Date() })
				.where(and(eq(bookings.id, target.bookingId), eq(bookings.status, fromStatus)))
				.returning({ id: bookings.id });
			if (flipped.length === 0) {
				throw new StatusOverrideError('This booking changed underneath this — reload and try again.');
			}
			await tx.insert(bookingStatusHistory).values({
				bookingId: target.bookingId,
				fromStatus,
				toStatus: targetStatus,
				note: `[Override] Reinstated — ${reason}`
			});
		} else {
			const flipped = await tx
				.update(hallBookings)
				.set({ status: targetStatus })
				.where(and(eq(hallBookings.id, target.hallBookingId), eq(hallBookings.status, 'cancelled')))
				.returning({ id: hallBookings.id });
			if (flipped.length === 0) {
				throw new StatusOverrideError('This event changed underneath this — reload and try again.');
			}
			await tx.insert(hallBookingStatusHistory).values({
				hallBookingId: target.hallBookingId,
				fromStatus: 'cancelled',
				toStatus: targetStatus,
				note: `[Override] Reinstated — ${reason}`
			});
		}

		if (order.status === 'cancelled') {
			await tx
				.update(orders)
				.set({ status: targetStatus, cancelledAt: null, updatedAt: new Date() })
				.where(eq(orders.id, order.id));
			await tx.insert(orderStatusHistory).values({
				orderId: order.id,
				fromStatus: 'cancelled',
				toStatus: targetStatus,
				note: `[Override] Reinstated — ${reason}`
			});
		}
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: target.kind === 'room' ? 'booking.reinstate' : 'hall_booking.reinstate',
		entityType: target.kind === 'room' ? 'booking' : 'hall_booking',
		entityId: lineId,
		after: { reason, reinstatedTo: targetStatus, refundReversed }
	});

	return { reinstatedTo: targetStatus, refundReversed };
}
