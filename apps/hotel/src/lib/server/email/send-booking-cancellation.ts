import { and, eq, ne } from 'drizzle-orm';
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
import { renderBookingCancellation, type CancellationEmailData } from './booking-cancellation';
import { sendMail, type SendMailResult } from './send';

const METHOD_LABEL: Record<string, string> = {
	cash: 'Cash',
	gcash: 'GCash',
	maya: 'Maya',
	bank_transfer: 'Bank transfer',
	card: 'Card'
};

/**
 * Emails the guest that a booking line was cancelled. Best-effort and never
 * throws — the cancel action treats it as fire-and-forget. Not idempotency-guarded
 * (a multi-line order can be cancelled a line at a time), so callers should invoke
 * it once per confirmed cancellation.
 */
export async function sendBookingCancellation(
	orderId: string,
	opts: {
		/** The cancelled `bookings.id` / `hallBookings.id`. */
		lineId: string;
		feeCentavos: number;
		refundCentavos: number;
		refundMethod: string;
	}
): Promise<SendMailResult & { skipped?: string }> {
	try {
		const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
		if (!order) return { ok: false, error: `order ${orderId} not found` };

		const [guest] = await db.select().from(guests).where(eq(guests.id, order.guestId));
		if (!guest?.email) return { ok: false, error: 'guest has no email address' };

		const [hotel] = await db.select().from(hotels).where(eq(hotels.id, order.hotelId));
		if (!hotel) return { ok: false, error: 'hotel not found' };

		const branding = parseBranding(hotel.config);

		// Label of the line that was cancelled.
		let cancelledLabel = 'Your booking';
		const [roomLine] = await db
			.select({ roomTypeName: roomTypes.name })
			.from(bookings)
			.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
			.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
			.where(eq(bookings.id, opts.lineId))
			.limit(1);
		if (roomLine) {
			cancelledLabel = roomLine.roomTypeName;
		} else {
			const [hallLine] = await db
				.select({ hallName: functionHalls.name, eventType: hallBookings.eventType })
				.from(hallBookings)
				.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
				.where(eq(hallBookings.id, opts.lineId))
				.limit(1);
			if (hallLine) cancelledLabel = `${hallLine.hallName} · ${hallLine.eventType}`;
		}

		// Whether anything still stands under the order.
		const [liveRoom] = await db
			.select({ id: bookings.id })
			.from(bookings)
			.where(
				and(
					eq(bookings.orderId, orderId),
					ne(bookings.status, 'cancelled'),
					ne(bookings.status, 'no_show')
				)
			)
			.limit(1);
		const [liveHall] = await db
			.select({ id: hallBookings.id })
			.from(hallBookings)
			.where(and(eq(hallBookings.orderId, orderId), ne(hallBookings.status, 'cancelled')))
			.limit(1);

		const data: CancellationEmailData = {
			hotel: {
				name: hotel.name,
				city: hotel.city ?? null,
				contactEmail: branding.contactEmail ?? null,
				contactPhone: branding.contactPhone ?? null,
				logoUrl: null,
				accentColor: branding.accentColor ?? DEFAULT_ACCENT_COLOR,
				paperColor: branding.paperColor ?? DEFAULT_PAPER_COLOR,
				currency: hotel.currency ?? 'PHP'
			},
			guestName: guest.fullName,
			confirmationCode: order.id.slice(0, 8).toUpperCase(),
			cancelledLabel,
			orderFullyCancelled: !liveRoom && !liveHall,
			feeCentavos: opts.feeCentavos,
			refundCentavos: opts.refundCentavos,
			refundMethodLabel:
				opts.refundCentavos > 0 ? (METHOD_LABEL[opts.refundMethod] ?? opts.refundMethod) : null
		};

		const { subject, html, text } = renderBookingCancellation(data);
		return await sendMail({
			hotelId: hotel.id,
			hotelName: hotel.name,
			orderId: order.id,
			type: 'booking_cancelled',
			to: guest.email,
			subject,
			html,
			text
		});
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		console.error('[email] sendBookingCancellation failed', orderId, error);
		return { ok: false, error };
	}
}
