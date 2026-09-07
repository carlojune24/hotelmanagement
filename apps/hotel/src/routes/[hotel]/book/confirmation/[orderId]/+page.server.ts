import { error } from '@sveltejs/kit';
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
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url, depends }) => {
	depends('app:booking-status');
	const hotelId = locals.hotel!.id;
	const token = url.searchParams.get('t');
	if (!token) error(404, 'Not found');

	const [order] = await db
		.select()
		.from(orders)
		.where(and(eq(orders.id, params.orderId), eq(orders.hotelId, hotelId)));
	if (!order || order.accessToken !== token) error(404, 'Not found');

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
			eventDate: hallBookings.eventDate,
			startTime: hallBookings.startTime,
			endTime: hallBookings.endTime,
			eventType: hallBookings.eventType,
			hallName: functionHalls.name
		})
		.from(hallBookings)
		.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
		.where(eq(hallBookings.orderId, order.id));

	return {
		status: order.status,
		order: {
			id: order.id,
			accessToken: order.accessToken,
			totalCentavos: order.totalCentavos,
			// Short, human-shareable stand-in for a proper OR/confirmation number —
			// derived from the order id itself so no extra column/sequence is needed.
			confirmationCode: order.id.slice(0, 8).toUpperCase()
		},
		guestName: guest!.fullName,
		roomLines,
		hallLines
	};
};
