import { error } from '@sveltejs/kit';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { bookingRooms, bookings, guests, orders, roomTypes } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import type { PageServerLoad } from './$types';

/** The OTA voucher as staff keyed it in, laid out like the printed voucher. Staff only. */
export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const hotel = locals.hotel!;
	const [row] = await db
		.select({ order: orders, guest: guests })
		.from(orders)
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.where(and(eq(orders.id, params.orderId), eq(orders.hotelId, hotel.id), isNotNull(orders.otaName)))
		.limit(1);
	if (!row) error(404, 'OTA booking not found');

	const lines = await db
		.select({
			roomType: roomTypes.name,
			checkIn: bookings.checkIn,
			checkOut: bookings.checkOut,
			occupancy: bookings.occupancy,
			extraBeds: bookingRooms.extraBeds,
			status: bookings.status
		})
		.from(bookings)
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
		.where(eq(bookings.orderId, row.order.id))
		.orderBy(asc(bookings.checkIn), asc(roomTypes.name));

	// One voucher row per room type, as the OTA prints it.
	const byType = new Map<string, { roomType: string; rooms: number; occupancy: number; extraBeds: number }>();
	for (const l of lines) {
		const t = byType.get(l.roomType) ?? { roomType: l.roomType, rooms: 0, occupancy: 0, extraBeds: 0 };
		t.rooms++;
		t.occupancy += l.occupancy;
		t.extraBeds += l.extraBeds;
		byType.set(l.roomType, t);
	}

	const o = row.order;
	return {
		hotelName: hotel.name,
		ota: { name: o.otaName!, reference: o.otaReference ?? '' },
		guest: { fullName: row.guest.fullName, email: row.guest.email.endsWith('@invalid') ? null : row.guest.email, phone: row.guest.phone, specialRequests: row.guest.specialRequests },
		checkIn: lines.reduce((m, l) => (l.checkIn < m ? l.checkIn : m), lines[0]?.checkIn ?? ''),
		checkOut: lines.reduce((m, l) => (l.checkOut > m ? l.checkOut : m), lines[0]?.checkOut ?? ''),
		rooms: [...byType.values()],
		cancelled: lines.length > 0 && lines.every((l) => l.status === 'cancelled' || l.status === 'no_show'),
		voucher: o.otaVoucher,
		netCentavos: o.otaNetCentavos ?? 0
	};
};
