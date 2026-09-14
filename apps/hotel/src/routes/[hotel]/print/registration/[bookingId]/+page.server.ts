import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { getRoomBookingDetail } from '$lib/server/reservations';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

/** Staff-only — this card carries a guest's captured ID photo, unlike Invoice/OR there's
 *  no guest-facing (access-token) path here. */
export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const hotel = locals.hotel!;

	const detail = await getRoomBookingDetail(hotel.id, params.bookingId);
	if (!detail) error(404, 'Booking not found');

	const [hotelRow] = await db
		.select({ name: hotels.name, legalName: hotels.legalName, addressLine: hotels.addressLine, city: hotels.city })
		.from(hotels)
		.where(eq(hotels.id, hotel.id))
		.limit(1);

	return {
		data: {
			hotel: {
				name: hotelRow?.name ?? hotel.name,
				legalName: hotelRow?.legalName ?? null,
				address: [hotelRow?.addressLine, hotelRow?.city].filter(Boolean).join(', ') || null
			},
			guest: {
				fullName: detail.guest.fullName,
				email: detail.guest.email,
				phone: detail.guest.phone
			},
			checkIn: detail.booking.checkIn,
			checkOut: detail.booking.checkOut,
			occupancy: detail.booking.occupancy,
			roomTypeName: detail.roomType.name,
			ratePlanName: detail.ratePlan.name,
			assignedRoomNumbers: detail.assignedRooms.map((r) => r.roomNumber),
			bookingRef: detail.booking.id.slice(0, 8).toUpperCase(),
			guestIdPhotoUrl: detail.booking.guestIdPhotoUrl
		},
		printedAt: new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
	};
};
