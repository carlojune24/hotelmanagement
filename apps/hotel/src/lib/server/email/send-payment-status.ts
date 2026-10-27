import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { attemptCode, diningOrders, guests, hotels, orders, paymentAttempts } from '../db/schema/index';
import { DEFAULT_ACCENT_COLOR, DEFAULT_PAPER_COLOR, parseBranding } from '../branding';
import { PENDING_ORDER_TTL_MINUTES } from '../orders';
import { renderPaymentStatus } from './payment-status';
import { sendMail, type SendMailResult } from './send';
import { hotelOrigin } from '../hotel-origin';

/**
 * Emails the guest where their payment stands: `tracking` when they start paying, `delayed` once if PayMongo has not
 * confirmed after a while. Goes only to the address the guest gave on the booking, once per attempt (the attempt row
 * remembers), and never throws: a mail problem must never touch the payment itself.
 */
export async function sendPaymentStatusEmail(
	attemptId: string,
	kind: 'tracking' | 'delayed'
): Promise<SendMailResult & { skipped?: string }> {
	try {
		const [attempt] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId)).limit(1);
		if (!attempt) return { ok: false, error: 'attempt not found' };
		if ((kind === 'tracking' ? attempt.trackingEmailAt : attempt.delayedEmailAt) !== null) {
			return { ok: true, skipped: 'already-sent' };
		}

		const [hotel] = await db.select().from(hotels).where(eq(hotels.id, attempt.hotelId)).limit(1);
		if (!hotel) return { ok: false, error: 'hotel not found' };
		const branding = parseBranding(hotel.config);
		const origin = hotelOrigin(hotel);

		let to: string | null = null;
		let guestName = 'there';
		let reference = '';
		let trackUrl = '';
		let holdUntil: string | null = null;
		let mailOrderId: string | null = null;

		if (attempt.scope === 'room' && attempt.orderId) {
			const [order] = await db.select().from(orders).where(eq(orders.id, attempt.orderId)).limit(1);
			if (!order) return { ok: false, error: 'order not found' };
			// A "still checking" note is only for a booking that is still waiting.
			if (kind === 'delayed' && order.status !== 'pending_payment') return { ok: true, skipped: 'not-pending' };
			const [guest] = await db.select().from(guests).where(eq(guests.id, order.guestId)).limit(1);
			to = guest?.email ?? null;
			guestName = guest?.fullName?.split(/\s+/)[0] ?? 'there';
			reference = order.id.slice(0, 8).toUpperCase();
			trackUrl = `${origin}/${hotel.slug}/confirmation/${order.id}?t=${order.accessToken}`;
			mailOrderId = order.id;
			holdUntil = new Date(order.createdAt.getTime() + PENDING_ORDER_TTL_MINUTES * 60_000).toLocaleString('en-PH', {
				timeZone: hotel.timezone,
				dateStyle: 'medium',
				timeStyle: 'short'
			});
		} else if (attempt.scope === 'dining' && attempt.diningOrderId) {
			const [order] = await db.select().from(diningOrders).where(eq(diningOrders.id, attempt.diningOrderId)).limit(1);
			if (!order) return { ok: false, error: 'dining order not found' };
			if (kind === 'delayed' && order.status !== 'pending_payment') return { ok: true, skipped: 'not-pending' };
			to = order.guestEmail ?? null;
			guestName = order.guestName?.split(/\s+/)[0] ?? 'there';
			reference = order.code;
			trackUrl = `${origin}/${hotel.slug}/dining/order/${order.code}?t=${order.accessToken}`;
		} else {
			return { ok: false, error: 'attempt has no order' };
		}
		if (!to) return { ok: true, skipped: 'no-email' };

		const { subject, html, text } = renderPaymentStatus({
			kind,
			hotel: {
				name: hotel.name,
				contactEmail: branding.contactEmail ?? null,
				contactPhone: branding.contactPhone ?? null,
				accentColor: branding.accentColor ?? DEFAULT_ACCENT_COLOR,
				paperColor: branding.paperColor ?? DEFAULT_PAPER_COLOR,
				currency: hotel.currency ?? 'PHP'
			},
			guestName,
			reference,
			checkCode: attemptCode(attempt.id),
			amountCentavos: attempt.amountCentavos,
			trackUrl,
			holdUntil
		});

		// Mark first: if the mail transport is down this is retried by nobody, which is right: a payment reminder is
		// not worth a duplicate. The attempt's own checking never depends on it.
		await db
			.update(paymentAttempts)
			.set(kind === 'tracking' ? { trackingEmailAt: new Date() } : { delayedEmailAt: new Date() })
			.where(eq(paymentAttempts.id, attempt.id));

		return await sendMail({
			hotelId: hotel.id,
			hotelName: hotel.name,
			orderId: mailOrderId,
			type: kind === 'tracking' ? 'payment_tracking' : 'payment_delayed',
			to,
			subject,
			html,
			text
		});
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		console.error('[email] sendPaymentStatusEmail failed', attemptId, error);
		return { ok: false, error };
	}
}
