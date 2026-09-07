import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import {
	bookingRooms,
	bookings,
	functionHalls,
	guests,
	hallBookings,
	orders,
	ratePlans,
	roomTypes
} from '$lib/server/db/schema/index';
import { createCheckoutSession, type CheckoutLineItem } from '$lib/server/paymongo/checkout';
import type { Actions, PageServerLoad } from './$types';

async function loadGuardedOrder(hotelId: string, orderId: string, token: string | null) {
	if (!token) error(404, 'Not found');
	const [order] = await db
		.select()
		.from(orders)
		.where(and(eq(orders.id, orderId), eq(orders.hotelId, hotelId)));
	if (!order || order.accessToken !== token) error(404, 'Not found');
	return order;
}

async function loadOrderLines(orderId: string) {
	const roomLines = await db
		.select({
			checkIn: bookings.checkIn,
			checkOut: bookings.checkOut,
			occupancy: bookings.occupancy,
			quantity: bookingRooms.quantity,
			subtotalCentavos: bookings.subtotalCentavos,
			totalCentavos: bookings.totalCentavos,
			roomTypeName: roomTypes.name,
			ratePlanName: ratePlans.name
		})
		.from(bookings)
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
		.innerJoin(ratePlans, eq(ratePlans.id, bookingRooms.ratePlanId))
		.where(eq(bookings.orderId, orderId));

	const hallLines = await db
		.select({
			eventDate: hallBookings.eventDate,
			startTime: hallBookings.startTime,
			endTime: hallBookings.endTime,
			eventType: hallBookings.eventType,
			guestCount: hallBookings.guestCount,
			subtotalCentavos: hallBookings.subtotalCentavos,
			totalCentavos: hallBookings.totalCentavos,
			hallName: functionHalls.name
		})
		.from(hallBookings)
		.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
		.where(eq(hallBookings.orderId, orderId));

	return { roomLines, hallLines };
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const hotelId = locals.hotel!.id;
	const order = await loadGuardedOrder(hotelId, params.orderId, url.searchParams.get('t'));

	if (order.status === 'confirmed') {
		redirect(303, `../confirmation/${order.id}?t=${order.accessToken}`);
	}

	const [guest] = await db.select().from(guests).where(eq(guests.id, order.guestId));
	const { roomLines, hallLines } = await loadOrderLines(order.id);

	return {
		order: {
			id: order.id,
			accessToken: order.accessToken,
			subtotalCentavos: order.subtotalCentavos,
			feesCentavos: order.feesCentavos,
			vatCentavos: order.vatCentavos,
			totalCentavos: order.totalCentavos
		},
		guest: { fullName: guest!.fullName, email: guest!.email },
		roomLines,
		hallLines,
		cancelled: url.searchParams.get('cancelled') === '1'
	};
};

export const actions: Actions = {
	pay: async (event) => {
		const hotelId = event.locals.hotel!.id;
		const token = event.url.searchParams.get('t');
		const order = await loadGuardedOrder(hotelId, event.params.orderId, token);

		if (order.status === 'confirmed') {
			redirect(303, `../confirmation/${order.id}?t=${order.accessToken}`);
		}
		if (order.status !== 'pending_payment') {
			return fail(400, { error: 'This order can no longer be paid.' });
		}

		const [guest] = await db.select().from(guests).where(eq(guests.id, order.guestId));
		const { roomLines, hallLines } = await loadOrderLines(order.id);

		const items: CheckoutLineItem[] = [
			...roomLines.map((r) => {
				const nights = Math.round((+new Date(r.checkOut) - +new Date(r.checkIn)) / 86_400_000);
				const qty = r.quantity > 1 ? ` × ${r.quantity} rooms` : '';
				return {
					name: `${r.roomTypeName} — ${r.ratePlanName}${qty}`,
					description: `${nights} night${nights === 1 ? '' : 's'}, ${r.checkIn} to ${r.checkOut}`,
					amountCentavos: r.subtotalCentavos
				};
			}),
			...hallLines.map((h) => ({
				name: h.hallName,
				description: `${h.eventType}, ${h.eventDate} ${h.startTime.slice(0, 5)}–${h.endTime.slice(0, 5)}`,
				amountCentavos: h.subtotalCentavos
			}))
		];

		const origin = event.url.origin;
		const successUrl = `${origin}/${event.locals.hotel!.slug}/book/confirmation/${order.id}?t=${order.accessToken}`;
		const cancelUrl = `${origin}/${event.locals.hotel!.slug}/book/review/${order.id}?t=${order.accessToken}&cancelled=1`;

		const { checkoutSessionId, checkoutUrl } = await createCheckoutSession({
			order,
			guest: guest!,
			hotelName: event.locals.hotel!.name,
			items,
			successUrl,
			cancelUrl
		});

		await db
			.update(orders)
			.set({ paymongoCheckoutSessionId: checkoutSessionId, updatedAt: new Date() })
			.where(eq(orders.id, order.id));

		redirect(303, checkoutUrl);
	}
};
