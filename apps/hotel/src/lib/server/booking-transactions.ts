import { and, eq, gte, inArray, lte, ne, gt, lt, or } from 'drizzle-orm';
import { db } from './db/index';
import {
	bookingRooms,
	bookings,
	functionHalls,
	guests,
	hallBookings,
	orders,
	roomAssignments,
	roomTypes,
	rooms
} from './db/schema/index';
import { loadOrderLedgers } from './folio';

export interface BookingTransactionRow {
	orderId: string;
	code: string;
	guestName: string;
	guestEmail: string;
	/** "Room D1, Room 101" / room type when no room is assigned yet / hall name. */
	roomLabel: string;
	/** Earliest arrival and latest departure across the booking's rooms/events. */
	checkIn: string;
	checkOut: string;
	lineCount: number;
	status: 'confirmed' | 'in_house' | 'checked_out' | 'cancelled';
	chargesCentavos: number;
	paidCentavos: number;
	balanceCentavos: number;
}

function summariseStatus(statuses: string[]): BookingTransactionRow['status'] {
	if (statuses.every((s) => s === 'cancelled' || s === 'no_show')) return 'cancelled';
	const live = statuses.filter((s) => s !== 'cancelled' && s !== 'no_show');
	if (live.some((s) => s === 'checked_in')) return 'in_house';
	if (live.every((s) => s === 'checked_out' || s === 'completed')) return 'checked_out';
	return 'confirmed';
}

/**
 * Every booking (order) with a room or event on any day of `[from, to]` (inclusive), whatever its
 * age — so a booking from last week stays reachable. A room counts when its stay touches the
 * range (arrival on or before `to`, departure on or after `from`); an event when its date is in it.
 * Unpaid online checkouts are left out (they are holds, not bookings yet). `q` matches the guest's
 * name/email or the booking code.
 */
export async function listBookingTransactions(
	hotelId: string,
	range: { from: string; to: string },
	q?: string
): Promise<BookingTransactionRow[]> {
	const [roomHits, hallHits] = await Promise.all([
		db
			.select({ orderId: bookings.orderId })
			.from(bookings)
			.where(
				and(
					eq(bookings.hotelId, hotelId),
					ne(bookings.status, 'pending_payment'),
					lte(bookings.checkIn, range.to),
					gte(bookings.checkOut, range.from)
				)
			),
		db
			.select({ orderId: hallBookings.orderId })
			.from(hallBookings)
			.innerJoin(orders, eq(orders.id, hallBookings.orderId))
			.where(
				and(
					eq(orders.hotelId, hotelId),
					ne(hallBookings.status, 'pending_payment'),
					gte(hallBookings.eventDate, range.from),
					lte(hallBookings.eventDate, range.to)
				)
			)
	]);
	const orderIds = [...new Set([...roomHits, ...hallHits].map((r) => r.orderId))];
	if (orderIds.length === 0) return [];

	const [orderRows, roomLines, hallLines, ledgers] = await Promise.all([
		db
			.select({
				id: orders.id,
				guestName: guests.fullName,
				guestEmail: guests.email
			})
			.from(orders)
			.innerJoin(guests, eq(guests.id, orders.guestId))
			.where(and(eq(orders.hotelId, hotelId), inArray(orders.id, orderIds))),
		db
			.select({
				id: bookings.id,
				orderId: bookings.orderId,
				status: bookings.status,
				checkIn: bookings.checkIn,
				checkOut: bookings.checkOut,
				typeName: roomTypes.name,
				bookingRoomId: bookingRooms.id
			})
			.from(bookings)
			.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
			.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
			.where(inArray(bookings.orderId, orderIds)),
		db
			.select({
				orderId: hallBookings.orderId,
				status: hallBookings.status,
				eventDate: hallBookings.eventDate,
				name: functionHalls.name
			})
			.from(hallBookings)
			.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
			.where(inArray(hallBookings.orderId, orderIds)),
		loadOrderLedgers(orderIds)
	]);

	const nums = roomLines.length
		? await db
				.select({ bookingRoomId: roomAssignments.bookingRoomId, roomNumber: rooms.roomNumber })
				.from(roomAssignments)
				.innerJoin(rooms, eq(rooms.id, roomAssignments.roomId))
				.where(
					inArray(
						roomAssignments.bookingRoomId,
						roomLines.map((l) => l.bookingRoomId)
					)
				)
		: [];

	const needle = q?.trim().toLowerCase() ?? '';
	const out: BookingTransactionRow[] = [];
	for (const o of orderRows) {
		const code = o.id.slice(0, 8).toUpperCase();
		if (
			needle &&
			!o.guestName.toLowerCase().includes(needle) &&
			!o.guestEmail.toLowerCase().includes(needle) &&
			!code.toLowerCase().startsWith(needle)
		)
			continue;

		const rl = roomLines.filter((l) => l.orderId === o.id);
		const hl = hallLines.filter((l) => l.orderId === o.id);
		const labels = [
			...rl.map((l) => {
				const n = nums.filter((x) => x.bookingRoomId === l.bookingRoomId).map((x) => x.roomNumber);
				return n.length ? `Room ${n.join(', ')}` : l.typeName;
			}),
			...hl.map((l) => l.name)
		];
		const starts = [...rl.map((l) => l.checkIn), ...hl.map((l) => l.eventDate)].sort();
		const ends = [...rl.map((l) => l.checkOut), ...hl.map((l) => l.eventDate)].sort();
		const ledger = ledgers.get(o.id);
		out.push({
			orderId: o.id,
			code,
			guestName: o.guestName,
			guestEmail: o.guestEmail,
			roomLabel: labels.join(', '),
			checkIn: starts[0] ?? '',
			checkOut: ends[ends.length - 1] ?? '',
			lineCount: rl.length + hl.length,
			status: summariseStatus([...rl.map((l) => l.status), ...hl.map((l) => l.status)]),
			chargesCentavos: ledger?.chargesTotalCentavos ?? 0,
			paidCentavos: ledger?.paidTotalCentavos ?? 0,
			balanceCentavos: ledger?.balanceCentavos ?? 0
		});
	}
	return out.sort((a, b) => (a.checkIn < b.checkIn ? 1 : a.checkIn > b.checkIn ? -1 : 0));
}
