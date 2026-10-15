import { error } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import {
	attemptCode,
	bookingRooms,
	bookings,
	functionHalls,
	guests,
	hallBookings,
	orders,
	paymentAttempts,
	payments,
	ratePlans,
	roomTypes
} from '$lib/server/db/schema/index';
import { verifyOrderNow } from '$lib/server/paymongo/verify';
import { getOrderPaymentSummary } from '$lib/server/order-payment';
import { getOrderPromo } from '$lib/server/promo-codes';
import { orderSecurityDepositCentavos } from '$lib/server/security-deposit-lookup';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url, depends }) => {
	depends('app:booking-status');
	const hotelId = locals.hotel!.id;
	const token = url.searchParams.get('t');
	if (!token) error(404, 'Not found');

	let [order] = await db
		.select()
		.from(orders)
		.where(and(eq(orders.id, params.orderId), eq(orders.hotelId, hotelId)));
	if (!order || order.accessToken !== token) error(404, 'Not found');

	// Still waiting? Ask PayMongo itself, not just our own records: the guest may have paid while our webhook could not
	// reach us. This runs on every load (a refresh, a poll, a return from PayMongo), throttled per order, so the page
	// recovers within seconds of the payment and never depends on a counter that a refresh would reset.
	if (order.status === 'pending_payment') {
		await verifyOrderNow({ orderId: order.id }).catch(() => null);
		const [fresh] = await db.select().from(orders).where(eq(orders.id, order.id));
		if (fresh) order = fresh;
	}

	const [guest] = await db.select().from(guests).where(eq(guests.id, order.guestId));

	const roomLines = await db
		.select({
			id: bookings.id,
			status: bookings.status,
			checkIn: bookings.checkIn,
			checkOut: bookings.checkOut,
			quantity: bookingRooms.quantity,
			roomTypeName: roomTypes.name,
			ratePlanName: ratePlans.name
		})
		.from(bookings)
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
		.innerJoin(ratePlans, eq(ratePlans.id, bookingRooms.ratePlanId))
		.where(eq(bookings.orderId, order.id));

	const hallLines = await db
		.select({
			id: hallBookings.id,
			eventDate: hallBookings.eventDate,
			startTime: hallBookings.startTime,
			endTime: hallBookings.endTime,
			eventType: hallBookings.eventType,
			hallName: functionHalls.name
		})
		.from(hallBookings)
		.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
		.where(eq(hallBookings.orderId, order.id));

	const payment = await getOrderPaymentSummary(order);
	const promo = await getOrderPromo(order.id);
	// A memo for the guest: refundable, collected at check-in, never part of what was paid.
	const securityDepositCentavos = await orderSecurityDepositCentavos(hotelId, order.id);

	// Where this payment stands, for the guest: the PayMongo payment ID once paid, and the payment check code while
	// we are still confirming it.
	const [paidAttempt] = await db
		.select()
		.from(paymentAttempts)
		.where(and(eq(paymentAttempts.orderId, order.id), eq(paymentAttempts.status, 'paid')))
		.orderBy(desc(paymentAttempts.paidAt))
		.limit(1);
	const [openAttempt] = await db
		.select()
		.from(paymentAttempts)
		.where(and(eq(paymentAttempts.orderId, order.id), eq(paymentAttempts.status, 'open')))
		.orderBy(desc(paymentAttempts.createdAt))
		.limit(1);
	// Older bookings (before attempts were kept): the recorded PayMongo payment row still has the ID.
	const [paidRow] = paidAttempt
		? []
		: await db
				.select({ paymentId: payments.paymongoPaymentId })
				.from(payments)
				.where(and(eq(payments.orderId, order.id), eq(payments.provider, 'paymongo'), eq(payments.status, 'paid')))
				.orderBy(desc(payments.createdAt))
				.limit(1);
	const paymentId = paidAttempt?.paymongoPaymentId ?? paidRow?.paymentId ?? null;

	return {
		/** Never an error code: the guest only sees "paid", "still checking", or what happened to the booking. */
		paymentRef: paymentId ? { paymentId, intentId: paidAttempt?.paymentIntentId ?? null } : null,
		tracking: {
			code: attemptCode((openAttempt ?? paidAttempt)?.id ?? order.id),
			waiting: !!openAttempt,
			checks: openAttempt?.checks ?? 0,
			lastCheckedAt: openAttempt?.lastCheckedAt?.toISOString() ?? null
		},
		status: order.status,
		// Null for an ordinary pay-in-full order — the page then keeps saying "Total paid".
		payment,
		promo,
		securityDepositCentavos,
		order: {
			id: order.id,
			accessToken: order.accessToken,
			totalCentavos: order.totalCentavos,
			// Short, human-shareable stand-in for a proper OR/confirmation number —
			// derived from the order id itself so no extra column/sequence is needed.
			confirmationCode: order.id.slice(0, 8).toUpperCase()
		},
		// Arrival essentials for the "What's next" block — the hotel's own configured times.
		stayInfo: {
			checkInTime: locals.hotel!.checkInTime,
			checkOutTime: locals.hotel!.checkOutTime
		},
		guestName: guest!.fullName,
		roomLines,
		hallLines
	};
};
