import { and, asc, eq } from 'drizzle-orm';
import { getOrderPaymentSummary } from '../order-payment';
import { env } from '$env/dynamic/private';
import { db } from '../db/index';
import {
	bookingRooms,
	bookings,
	documents,
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
import { renderPdf } from '../pdf/render';
import { alreadySent, sendMail, type MailAttachment, type SendMailResult } from './send';

/**
 * Gathers an order's data and sends the guest their booking-confirmation email.
 * Idempotent by default (skips if a `sent` row is already logged for the order)
 * and never throws — the PayMongo webhook treats it as best-effort. Pass
 * `{ force: true }` for a deliberate staff resend, which bypasses that guard.
 */
export async function sendBookingConfirmation(
	orderId: string,
	opts: { force?: boolean } = {}
): Promise<SendMailResult & { skipped?: string }> {
	try {
		if (!opts.force && (await alreadySent(orderId, 'booking_confirmation'))) {
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
		const manageUrl = `${origin}/${hotel.slug}/confirmation/${order.id}?t=${order.accessToken}`;
		const manageBookingUrl = `${origin}/${hotel.slug}/manage/${order.id}?t=${order.accessToken}`;

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
			payment: await getOrderPaymentSummary(order),
			manageUrl,
			manageBookingUrl
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
			text,
			attachments: await receiptAttachments(hotel.slug, order.id, order.accessToken)
		});
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		console.error('[email] sendBookingConfirmation failed', orderId, error);
		return { ok: false, error };
	}
}

/**
 * PDFs of every Official Receipt already issued against the order (normally the one
 * the PayMongo webhook just issued). Rendered through the guest-token print route, so
 * the attachment is byte-for-byte the document the guest can reopen from their link.
 * Best-effort: a render failure drops that attachment, never the email.
 */
async function receiptAttachments(
	slug: string,
	orderId: string,
	accessToken: string
): Promise<MailAttachment[]> {
	const receipts = await db
		.select({ id: documents.id, formattedNo: documents.formattedNo })
		.from(documents)
		.where(
			and(
				eq(documents.orderId, orderId),
				eq(documents.type, 'official_receipt'),
				eq(documents.status, 'issued')
			)
		)
		.orderBy(asc(documents.serialNo));

	const attachments: MailAttachment[] = [];
	for (const r of receipts) {
		try {
			const content = await renderPdf(
				`/${slug}/print/receipt/${r.id}?t=${encodeURIComponent(accessToken)}&format=a4`
			);
			attachments.push({
				filename: `Official-Receipt-${r.formattedNo}.pdf`,
				content,
				contentType: 'application/pdf'
			});
		} catch (e) {
			console.error('[email] could not render receipt PDF', r.id, e);
		}
	}
	return attachments;
}
