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
	roomTypes
} from '../db/schema/index';
import { DEFAULT_ACCENT_COLOR, DEFAULT_PAPER_COLOR, parseBranding } from '../branding';
import { PENDING_ORDER_TTL_MINUTES } from '../orders';
import { renderPaymentLink } from './payment-link';
import { sendMail, type SendMailResult } from './send';

/**
 * Emails the guest a link back to the payment step of an unpaid online booking (the guest closed the
 * checkout before paying). Only for an order still `pending_payment`; best-effort, never throws.
 * Sending again is allowed — staff trigger it on demand and each attempt is logged.
 */
export async function sendPaymentLink(orderId: string): Promise<SendMailResult> {
	try {
		const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
		if (!order) return { ok: false, error: `order ${orderId} not found` };
		if (order.status !== 'pending_payment')
			return {
				ok: false,
				error:
					order.status === 'cancelled'
						? 'This booking was released because it was not paid in time.'
						: 'This booking is already paid.'
			};

		const [guest] = await db.select().from(guests).where(eq(guests.id, order.guestId));
		if (!guest?.email) return { ok: false, error: 'guest has no email address' };
		const [hotel] = await db.select().from(hotels).where(eq(hotels.id, order.hotelId));
		if (!hotel) return { ok: false, error: 'hotel not found' };
		const branding = parseBranding(hotel.config);

		const [roomLines, hallLines] = await Promise.all([
			db
				.select({ name: roomTypes.name, quantity: bookingRooms.quantity })
				.from(bookings)
				.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
				.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
				.where(eq(bookings.orderId, orderId)),
			db
				.select({ name: functionHalls.name, eventType: hallBookings.eventType })
				.from(hallBookings)
				.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
				.where(eq(hallBookings.orderId, orderId))
		]);

		const origin = (env.ORIGIN ?? '').replace(/\/$/, '');
		const expiresAt = new Date(order.createdAt.getTime() + PENDING_ORDER_TTL_MINUTES * 60_000);
		const holdUntil = expiresAt.toLocaleString('en-PH', {
			timeZone: hotel.timezone,
			dateStyle: 'medium',
			timeStyle: 'short'
		});

		const { subject, html, text } = renderPaymentLink({
			hotel: {
				name: hotel.name,
				city: hotel.city ?? null,
				contactEmail: branding.contactEmail ?? null,
				contactPhone: branding.contactPhone ?? null,
				accentColor: branding.accentColor ?? DEFAULT_ACCENT_COLOR,
				paperColor: branding.paperColor ?? DEFAULT_PAPER_COLOR,
				currency: hotel.currency ?? 'PHP'
			},
			guestName: guest.fullName,
			confirmationCode: order.id.slice(0, 8).toUpperCase(),
			lines: [
				...roomLines.map((l) => (l.quantity > 1 ? `${l.name} × ${l.quantity}` : l.name)),
				...hallLines.map((l) => `${l.name} · ${l.eventType}`)
			],
			totalCentavos: order.totalCentavos,
			dueNowCentavos: order.amountDueNowCentavos ?? order.totalCentavos,
			payUrl: `${origin}/${hotel.slug}/review/${order.id}?t=${order.accessToken}`,
			holdUntil
		});

		return await sendMail({
			hotelId: hotel.id,
			hotelName: hotel.name,
			orderId: order.id,
			type: 'payment_link',
			to: guest.email,
			subject,
			html,
			text
		});
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		console.error('[email] sendPaymentLink failed', orderId, error);
		return { ok: false, error };
	}
}
