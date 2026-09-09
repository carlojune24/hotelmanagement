import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '../db/index';
import {
	bookingRooms,
	bookings,
	functionHalls,
	guests,
	hallBookings,
	hotels,
	orders,
	ratePlans,
	roomTypes
} from '../db/schema/index';
import { DEFAULT_ACCENT_COLOR, DEFAULT_PAPER_COLOR, parseBranding } from '../branding';
import { renderBookingConfirmation, type BookingConfirmationData } from './booking-confirmation';
import { alreadySent, sendMail, type SendMailResult } from './send';

/**
 * Gathers an order's data and sends the guest their booking-confirmation email.
 * Idempotent (skips if a `sent` row is already logged for the order) and never
 * throws — the caller (the PayMongo webhook) treats it as best-effort.
 */
export async function sendBookingConfirmation(
	orderId: string
): Promise<SendMailResult & { skipped?: string }> {
	try {
		if (await alreadySent(orderId, 'booking_confirmation')) {
			return { ok: true, skipped: 'already-sent' };
		}

		const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
		if (!order) return { ok: false, error: `order ${orderId} not found` };

		const [guest] = await db.select().from(guests).where(eq(guests.id, order.guestId));
		if (!guest?.email) return { ok: false, error: 'guest has no email address' };

		const [hotel] = await db.select().from(hotels).where(eq(hotels.id, order.hotelId));
		if (!hotel) return { ok: false, error: 'hotel not found' };

		const branding = parseBranding(hotel.config);

		const roomLines = await db
			.select({
				roomTypeName: roomTypes.name,
				ratePlanName: ratePlans.name,
				quantity: bookingRooms.quantity,
				checkIn: bookings.checkIn,
				checkOut: bookings.checkOut
			})
			.from(bookings)
			.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
			.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
			.innerJoin(ratePlans, eq(ratePlans.id, bookingRooms.ratePlanId))
			.where(eq(bookings.orderId, order.id));

		const hallLines = await db
			.select({
				hallName: functionHalls.name,
				eventType: hallBookings.eventType,
				eventDate: hallBookings.eventDate,
				startTime: hallBookings.startTime,
				endTime: hallBookings.endTime
			})
			.from(hallBookings)
			.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
			.where(eq(hallBookings.orderId, order.id));

		const origin = (env.ORIGIN ?? '').replace(/\/$/, '');
		const manageUrl = `${origin}/${hotel.slug}/book/confirmation/${order.id}?t=${order.accessToken}`;

		let logoUrl: string | null = null;
		if (branding.logoUrl) {
			logoUrl = /^https?:\/\//.test(branding.logoUrl)
				? branding.logoUrl
				: `${origin}${branding.logoUrl}`;
		}

		const data: BookingConfirmationData = {
			hotel: {
				name: hotel.name,
				city: hotel.city ?? null,
				address: hotel.addressLine ?? branding.contactAddress ?? null,
				contactEmail: branding.contactEmail ?? null,
				contactPhone: branding.contactPhone ?? null,
				logoUrl,
				checkInTime: hotel.checkInTime,
				checkOutTime: hotel.checkOutTime,
				accentColor: branding.accentColor ?? DEFAULT_ACCENT_COLOR,
				paperColor: branding.paperColor ?? DEFAULT_PAPER_COLOR,
				currency: hotel.currency ?? 'PHP'
			},
			guestName: guest.fullName,
			confirmationCode: order.id.slice(0, 8).toUpperCase(),
			roomLines,
			hallLines,
			subtotalCentavos: order.subtotalCentavos,
			feesCentavos: order.feesCentavos,
			vatCentavos: order.vatCentavos,
			totalCentavos: order.totalCentavos,
			manageUrl
		};

		const { subject, html, text } = renderBookingConfirmation(data);
		return await sendMail({
			hotelId: hotel.id,
			hotelName: hotel.name,
			orderId: order.id,
			type: 'booking_confirmation',
			to: guest.email,
			subject,
			html,
			text
		});
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		console.error('[email] sendBookingConfirmation failed', orderId, error);
		return { ok: false, error };
	}
}
