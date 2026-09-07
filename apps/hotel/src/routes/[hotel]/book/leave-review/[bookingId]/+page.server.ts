import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	bookingRooms,
	bookings,
	guests,
	orders,
	reviews,
	roomTypes
} from '$lib/server/db/schema/index';
import type { Actions, PageServerLoad } from './$types';

async function loadGuardedBooking(hotelId: string, bookingId: string, token: string | null) {
	if (!token) error(404, 'Not found');
	const [row] = await db
		.select({
			bookingId: bookings.id,
			status: bookings.status,
			checkIn: bookings.checkIn,
			checkOut: bookings.checkOut,
			accessToken: orders.accessToken,
			guestFullName: guests.fullName
		})
		.from(bookings)
		.innerJoin(orders, eq(orders.id, bookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)));
	if (!row || row.accessToken !== token) error(404, 'Not found');
	return row;
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const hotelId = locals.hotel!.id;
	const booking = await loadGuardedBooking(hotelId, params.bookingId, url.searchParams.get('t'));

	const [room] = await db
		.select({ roomTypeName: roomTypes.name })
		.from(bookingRooms)
		.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
		.where(eq(bookingRooms.bookingId, booking.bookingId));

	const [existingReview] = await db
		.select({
			status: reviews.status,
			rating: reviews.rating,
			comment: reviews.comment,
			moderationNote: reviews.moderationNote
		})
		.from(reviews)
		.where(eq(reviews.bookingId, booking.bookingId));

	return {
		stayComplete: booking.status === 'checked_out',
		roomTypeName: room?.roomTypeName ?? '',
		checkIn: booking.checkIn,
		checkOut: booking.checkOut,
		guestFullName: booking.guestFullName,
		existingReview: existingReview ?? null
	};
};

const submitSchema = z.object({
	rating: z.coerce.number().int().min(1).max(5),
	guestDisplayName: z.string().min(1).max(120),
	comment: z.string().min(10).max(2000)
});

export const actions: Actions = {
	submit: async (event) => {
		const hotelId = event.locals.hotel!.id;
		const token = event.url.searchParams.get('t');
		const booking = await loadGuardedBooking(hotelId, event.params.bookingId, token);

		if (booking.status !== 'checked_out') {
			return fail(400, { error: 'Reviews can only be left after your stay is complete.' });
		}

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = submitSchema.safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Add a rating and a few words about your stay.' });

		try {
			await db.insert(reviews).values({
				hotelId,
				bookingId: booking.bookingId,
				rating: parsed.data.rating,
				comment: parsed.data.comment.trim(),
				guestDisplayName: parsed.data.guestDisplayName.trim()
			});
		} catch (e) {
			if (e instanceof Error && 'code' in e && (e as { code: string }).code === '23505') {
				return fail(400, { error: 'You’ve already left a review for this stay.' });
			}
			throw e;
		}

		return { ok: 'Thanks for your review! It’ll appear once our team takes a look.' };
	}
};
