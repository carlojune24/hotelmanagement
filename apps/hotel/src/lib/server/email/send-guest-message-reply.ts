import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '../db/index';
import { guests, hotels, orders } from '../db/schema/index';
import { DEFAULT_ACCENT_COLOR, DEFAULT_PAPER_COLOR, parseBranding } from '../branding';
import { renderGuestMessageReply, type GuestMessageReplyEmailData } from './guest-message-reply';
import { sendMail, type SendMailResult } from './send';

/**
 * Emails the guest that staff replied to their message/cancellation request on
 * `/book/manage` — the nudge back to a page with no push/polling. Best-effort
 * and never throws; not idempotency-guarded, since each staff reply is its own
 * distinct notice (unlike the confirmation/cancellation emails, there's no
 * single "already sent" state for an ongoing conversation).
 */
export async function sendGuestMessageReply(
	orderId: string,
	replyBody: string
): Promise<SendMailResult> {
	try {
		const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
		if (!order) return { ok: false, error: `order ${orderId} not found` };

		const [guest] = await db.select().from(guests).where(eq(guests.id, order.guestId));
		if (!guest?.email) return { ok: false, error: 'guest has no email address' };

		const [hotel] = await db.select().from(hotels).where(eq(hotels.id, order.hotelId));
		if (!hotel) return { ok: false, error: 'hotel not found' };

		const branding = parseBranding(hotel.config);
		const origin = (env.ORIGIN ?? '').replace(/\/$/, '');
		const manageUrl = `${origin}/${hotel.slug}/book/manage/${order.id}?t=${order.accessToken}`;

		const data: GuestMessageReplyEmailData = {
			hotel: {
				name: hotel.name,
				city: hotel.city ?? null,
				logoUrl: null,
				accentColor: branding.accentColor ?? DEFAULT_ACCENT_COLOR,
				paperColor: branding.paperColor ?? DEFAULT_PAPER_COLOR
			},
			guestName: guest.fullName,
			confirmationCode: order.id.slice(0, 8).toUpperCase(),
			replyBody,
			manageUrl
		};

		const { subject, html, text } = renderGuestMessageReply(data);
		return await sendMail({
			hotelId: hotel.id,
			hotelName: hotel.name,
			orderId: order.id,
			type: 'guest_message_reply',
			to: guest.email,
			subject,
			html,
			text
		});
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		console.error('[email] sendGuestMessageReply failed', orderId, error);
		return { ok: false, error };
	}
}
