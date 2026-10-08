import { asc, eq, inArray } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '../db/index';
import { diningItems, diningOrderItemAddons, diningOrderItems, diningOrders, hotels } from '../db/schema/index';
import { DEFAULT_ACCENT_COLOR, DEFAULT_PAPER_COLOR, parseBranding } from '../branding';
import { renderDiningOrder } from './dining-order';
import { sendMail, type SendMailResult } from './send';

/**
 * Emails the guest about their online order: `confirmation` once the kitchen has it, `ready` when it
 * is done. Best-effort and never throws: the order is already saved, and a missing address or a mail
 * failure must not undo anything (a failure is recorded in `email_log`).
 */
export async function sendDiningOrderEmail(
	orderId: string,
	kind: 'confirmation' | 'ready'
): Promise<SendMailResult & { skipped?: string }> {
	try {
		const [order] = await db.select().from(diningOrders).where(eq(diningOrders.id, orderId));
		if (!order) return { ok: false, error: `order ${orderId} not found` };
		if (!order.guestEmail) return { ok: true, skipped: 'no-email' };

		const [venue] = await db.select({ title: diningItems.title }).from(diningItems).where(eq(diningItems.id, order.diningItemId));
		const [hotel] = await db.select().from(hotels).where(eq(hotels.id, order.hotelId));
		if (!hotel) return { ok: false, error: 'hotel not found' };
		const branding = parseBranding(hotel.config);

		const items = await db.select().from(diningOrderItems).where(eq(diningOrderItems.orderId, order.id)).orderBy(asc(diningOrderItems.sortOrder));
		const addons = items.length
			? await db.select().from(diningOrderItemAddons).where(inArray(diningOrderItemAddons.orderItemId, items.map((i) => i.id)))
			: [];

		const origin = (env.ORIGIN ?? '').replace(/\/$/, '');
		const logoUrl = branding.logoUrl ? (/^https?:\/\//.test(branding.logoUrl) ? branding.logoUrl : `${origin}${branding.logoUrl}`) : null;
		const fmt = (opts: Intl.DateTimeFormatOptions) =>
			order.pickupAt ? new Intl.DateTimeFormat('en-PH', { ...opts, timeZone: hotel.timezone }).format(order.pickupAt) : null;

		const rendered = renderDiningOrder({
			kind,
			hotel: {
				name: hotel.name,
				city: hotel.city,
				address: hotel.addressLine ?? branding.contactAddress ?? null,
				contactEmail: branding.contactEmail ?? null,
				contactPhone: branding.contactPhone ?? null,
				logoUrl,
				accentColor: branding.accentColor ?? DEFAULT_ACCENT_COLOR,
				paperColor: branding.paperColor ?? DEFAULT_PAPER_COLOR
			},
			guestName: order.guestName ?? 'Guest',
			venueTitle: venue?.title ?? hotel.name,
			code: order.code,
			orderType: order.orderType,
			pickupDateLabel: fmt({ weekday: 'short', month: 'short', day: 'numeric' }),
			pickupTimeLabel: fmt({ hour: 'numeric', minute: '2-digit' }),
			items: items.map((i) => ({
				name: i.name,
				quantity: i.quantity,
				addons: addons.filter((a) => a.orderItemId === i.id).map((a) => a.name),
				remarks: i.remarks,
				lineTotalCentavos: i.lineTotalCentavos
			})),
			totalCentavos: order.totalCentavos,
			payment: order.paymentStatus === 'paid' ? 'paid' : 'pay_at_venue',
			remarks: order.remarks,
			trackUrl: `${origin}/${hotel.slug}/dining/order/${order.code}?t=${order.accessToken}`
		});

		return await sendMail({
			hotelId: hotel.id,
			hotelName: hotel.name,
			type: kind === 'ready' ? 'dining_order_ready' : 'dining_order',
			to: order.guestEmail,
			...rendered
		});
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		console.error('[email] dining order email failed', kind, error);
		return { ok: false, error };
	}
}
