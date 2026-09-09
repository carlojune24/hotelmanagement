import { and, desc, eq } from 'drizzle-orm';
import { db } from './db/index';
import {
	bookings,
	bookingRooms,
	bookingStatusHistory,
	emailLog,
	hallBookings,
	hallBookingStatusHistory,
	orders,
	guests,
	payments,
	roomTypes,
	ratePlans,
	functionHalls,
	rooms,
	roomAssignments
} from './db/schema/index';

/** Confirmation-email attempts for an order, newest first. */
function orderEmails(orderId: string) {
	return db
		.select()
		.from(emailLog)
		.where(and(eq(emailLog.orderId, orderId), eq(emailLog.type, 'booking_confirmation')))
		.orderBy(desc(emailLog.createdAt));
}

export type ReservationKind = 'room' | 'hall';

/**
 * One row per booking line (a room stay or a hall reservation), not per order —
 * an order with both a room and a hall shows as two lines here, each linking
 * back to the same guest/order. Matches how the data is actually modeled
 * (`bookings`/`hallBookings` are separate tables under one `orders` row) rather
 * than inventing a merged synthetic status.
 */
export interface ReservationLine {
	kind: ReservationKind;
	id: string;
	orderId: string;
	guestName: string;
	guestEmail: string;
	title: string;
	subtitle: string;
	startDate: string;
	endDate: string | null;
	status: string;
	orderStatus: string;
	totalCentavos: number;
	createdAt: Date;
}

/** Every booking line for a hotel, newest first — verification list, not a dated calendar view. */
export async function listReservationLines(hotelId: string): Promise<ReservationLine[]> {
	const roomRows = await db
		.select({
			id: bookings.id,
			orderId: bookings.orderId,
			guestName: guests.fullName,
			guestEmail: guests.email,
			roomTypeName: roomTypes.name,
			ratePlanName: ratePlans.name,
			checkIn: bookings.checkIn,
			checkOut: bookings.checkOut,
			status: bookings.status,
			orderStatus: orders.status,
			totalCentavos: bookings.totalCentavos,
			createdAt: bookings.createdAt
		})
		.from(bookings)
		.innerJoin(orders, eq(orders.id, bookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
		.innerJoin(ratePlans, eq(ratePlans.id, bookingRooms.ratePlanId))
		.where(eq(bookings.hotelId, hotelId));

	const hallRows = await db
		.select({
			id: hallBookings.id,
			orderId: hallBookings.orderId,
			guestName: guests.fullName,
			guestEmail: guests.email,
			hallName: functionHalls.name,
			eventType: hallBookings.eventType,
			eventDate: hallBookings.eventDate,
			status: hallBookings.status,
			orderStatus: orders.status,
			totalCentavos: hallBookings.totalCentavos,
			createdAt: hallBookings.createdAt
		})
		.from(hallBookings)
		.innerJoin(orders, eq(orders.id, hallBookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
		.where(eq(orders.hotelId, hotelId));

	const lines: ReservationLine[] = [
		...roomRows.map((r) => ({
			kind: 'room' as const,
			id: r.id,
			orderId: r.orderId,
			guestName: r.guestName,
			guestEmail: r.guestEmail,
			title: r.roomTypeName,
			subtitle: r.ratePlanName,
			startDate: r.checkIn,
			endDate: r.checkOut,
			status: r.status,
			orderStatus: r.orderStatus,
			totalCentavos: r.totalCentavos,
			createdAt: r.createdAt
		})),
		...hallRows.map((h) => ({
			kind: 'hall' as const,
			id: h.id,
			orderId: h.orderId,
			guestName: h.guestName,
			guestEmail: h.guestEmail,
			title: h.hallName,
			subtitle: h.eventType,
			startDate: h.eventDate,
			endDate: null,
			status: h.status,
			orderStatus: h.orderStatus,
			totalCentavos: h.totalCentavos,
			createdAt: h.createdAt
		}))
	];

	return lines.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function getRoomBookingDetail(hotelId: string, bookingId: string) {
	const [row] = await db
		.select({
			booking: bookings,
			order: orders,
			guest: guests,
			roomType: roomTypes,
			ratePlan: ratePlans,
			bookingRoom: bookingRooms
		})
		.from(bookings)
		.innerJoin(orders, eq(orders.id, bookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
		.innerJoin(ratePlans, eq(ratePlans.id, bookingRooms.ratePlanId))
		.where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)))
		.limit(1);
	if (!row) return null;

	const [history, paymentRows, assignedRooms, confirmationEmails] = await Promise.all([
		db
			.select()
			.from(bookingStatusHistory)
			.where(eq(bookingStatusHistory.bookingId, bookingId))
			.orderBy(desc(bookingStatusHistory.createdAt)),
		db
			.select()
			.from(payments)
			.where(eq(payments.orderId, row.order.id))
			.orderBy(desc(payments.createdAt)),
		db
			.select({ roomNumber: rooms.roomNumber })
			.from(roomAssignments)
			.innerJoin(rooms, eq(rooms.id, roomAssignments.roomId))
			.where(eq(roomAssignments.bookingRoomId, row.bookingRoom.id)),
		orderEmails(row.order.id)
	]);

	return { ...row, history, payments: paymentRows, assignedRooms, confirmationEmails };
}

export async function getHallBookingDetail(hotelId: string, hallBookingId: string) {
	const [row] = await db
		.select({
			hallBooking: hallBookings,
			order: orders,
			guest: guests,
			hall: functionHalls
		})
		.from(hallBookings)
		.innerJoin(orders, eq(orders.id, hallBookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
		.where(and(eq(hallBookings.id, hallBookingId), eq(orders.hotelId, hotelId)))
		.limit(1);
	if (!row) return null;

	const [history, paymentRows, confirmationEmails] = await Promise.all([
		db
			.select()
			.from(hallBookingStatusHistory)
			.where(eq(hallBookingStatusHistory.hallBookingId, hallBookingId))
			.orderBy(desc(hallBookingStatusHistory.createdAt)),
		db
			.select()
			.from(payments)
			.where(eq(payments.orderId, row.order.id))
			.orderBy(desc(payments.createdAt)),
		orderEmails(row.order.id)
	]);

	return { ...row, history, payments: paymentRows, confirmationEmails };
}
