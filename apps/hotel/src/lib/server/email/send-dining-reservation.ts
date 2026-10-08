import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '../db/index';
import { diningItems, diningReservations, hotels } from '../db/schema/index';
import { parseBranding } from '../branding';
import { DEFAULT_ACCENT_COLOR, DEFAULT_PAPER_COLOR } from '../branding';
import { renderDiningReservation } from './dining-reservation';
import { sendMail, type SendMailResult } from './send';

/**
 * Sends the guest their table-reservation confirmation. Best-effort and never throws:
 * a reservation is already saved by the time this runs, and a missing email address or a
 * mail failure must not undo it (the failure is recorded in `email_log`).
 */
export async function sendDiningReservationConfirmation(
	reservationId: string
): Promise<SendMailResult & { skipped?: string }> {
	try {
		const [row] = await db
			.select({ r: diningReservations, venueTitle: diningItems.title })
			.from(diningReservations)
			.innerJoin(diningItems, eq(diningItems.id, diningReservations.diningItemId))
			.where(eq(diningReservations.id, reservationId));
		if (!row) return { ok: false, error: `reservation ${reservationId} not found` };
		if (!row.r.guestEmail) return { ok: true, skipped: 'no-email' };

		const [hotel] = await db.select().from(hotels).where(eq(hotels.id, row.r.hotelId));
		if (!hotel) return { ok: false, error: 'hotel not found' };
		const branding = parseBranding(hotel.config);

		const origin = (env.ORIGIN ?? '').replace(/\/$/, '');
		const logoUrl = branding.logoUrl
			? /^https?:\/\//.test(branding.logoUrl)
				? branding.logoUrl
				: `${origin}${branding.logoUrl}`
			: null;

		const fmt = (opts: Intl.DateTimeFormatOptions) =>
			new Intl.DateTimeFormat('en-PH', { ...opts, timeZone: hotel.timezone }).format(row.r.startsAt);

		const rendered = renderDiningReservation({
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
			guestName: row.r.guestName,
			venueTitle: row.venueTitle,
			code: row.r.code,
			partySize: row.r.partySize,
			dateLabel: fmt({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
			timeLabel: fmt({ hour: 'numeric', minute: '2-digit' }),
			remarks: row.r.remarks,
			ticketUrl: `${origin}/${hotel.slug}/dining/reserve/${row.r.code}?t=${row.r.accessToken}`
		});

		return await sendMail({
			hotelId: hotel.id,
			hotelName: hotel.name,
			type: 'dining_reservation',
			to: row.r.guestEmail,
			...rendered
		});
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		console.error('[email] dining reservation confirmation failed', error);
		return { ok: false, error };
	}
}
