import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '../db/index';
import { bookingRooms, bookings, guests, hotels, orders, roomTypes } from '../db/schema/index';
import { DEFAULT_ACCENT_COLOR, DEFAULT_PAPER_COLOR, parseBranding } from '../branding';
import { renderBookingReviewRequest, type ReviewRequestEmailData } from './booking-review-request';
import { sendMail, type SendMailResult } from './send';

/**
 * Emails the guest a "how was your stay?" prompt after a room booking is
 * checked out. Best-effort and never throws — the checkout action treats it
 * as fire-and-forget. No idempotency guard: `email_log` only keys on
 * `orderId` (not booking), and `checkOutBooking` itself already refuses to
 * check out a line twice, so this can only ever fire once per booking.
 */
export async function sendBookingReviewRequest(bookingId: string): Promise<SendMailResult & { skipped?: string }> {
	try {
		const [row] = await db
			.select({
				bookingId: bookings.id,
				orderId: bookings.orderId,
				roomTypeName: roomTypes.name
			})
			.from(bookings)
			.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
			.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
			.where(eq(bookings.id, bookingId))
			.limit(1);
		if (!row) return { ok: false, error: `booking ${bookingId} not found` };

		const [order] = await db.select().from(orders).where(eq(orders.id, row.orderId));
		if (!order) return { ok: false, error: `order ${row.orderId} not found` };

		const [guest] = await db.select().from(guests).where(eq(guests.id, order.guestId));
		if (!guest?.email) return { ok: false, error: 'guest has no email address' };

		const [hotel] = await db.select().from(hotels).where(eq(hotels.id, order.hotelId));
		if (!hotel) return { ok: false, error: 'hotel not found' };

		const branding = parseBranding(hotel.config);
		const origin = (env.ORIGIN ?? '').replace(/\/$/, '');
		const reviewUrl = `${origin}/${hotel.slug}/leave-review/${bookingId}?t=${order.accessToken}`;

		const data: ReviewRequestEmailData = {
			hotel: {
				name: hotel.name,
				city: hotel.city ?? null,
				contactEmail: branding.contactEmail ?? null,
				contactPhone: branding.contactPhone ?? null,
				logoUrl: null,
				accentColor: branding.accentColor ?? DEFAULT_ACCENT_COLOR,
				paperColor: branding.paperColor ?? DEFAULT_PAPER_COLOR
			},
			guestName: guest.fullName,
			confirmationCode: order.id.slice(0, 8).toUpperCase(),
			roomTypeName: row.roomTypeName,
			reviewUrl
		};

		const { subject, html, text } = renderBookingReviewRequest(data);
		return await sendMail({
			hotelId: hotel.id,
			hotelName: hotel.name,
			orderId: order.id,
			type: 'review_requested',
			to: guest.email,
			subject,
			html,
			text
		});
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		console.error('[email] sendBookingReviewRequest failed', bookingId, error);
		return { ok: false, error };
	}
}
