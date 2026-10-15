import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { hotels } from '../db/schema/index';
import { DEFAULT_ACCENT_COLOR, DEFAULT_PAPER_COLOR, parseBranding } from '../branding';
import { renderSupportReply } from './support-reply';
import { sendMail, type SendMailResult } from './send';

/**
 * Emails a guest the staff answer to a message they left while the Support chat was offline.
 * Best-effort and never throws; every reply is its own notice, so there is no already-sent guard.
 */
export async function sendSupportReply(args: {
	hotelId: string;
	to: string;
	guestName: string;
	originalMessage: string;
	replyBody: string;
	staffName: string;
}): Promise<SendMailResult> {
	try {
		const [hotel] = await db.select().from(hotels).where(eq(hotels.id, args.hotelId));
		if (!hotel) return { ok: false, error: 'hotel not found' };
		const branding = parseBranding(hotel.config);
		const { subject, html, text } = renderSupportReply({
			hotel: {
				name: hotel.name,
				city: hotel.city ?? null,
				accentColor: branding.accentColor ?? DEFAULT_ACCENT_COLOR,
				paperColor: branding.paperColor ?? DEFAULT_PAPER_COLOR
			},
			guestName: args.guestName,
			originalMessage: args.originalMessage,
			replyBody: args.replyBody,
			staffName: args.staffName
		});
		return await sendMail({
			hotelId: hotel.id,
			hotelName: hotel.name,
			type: 'support_reply',
			to: args.to,
			subject,
			html,
			text
		});
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		console.error('[email] sendSupportReply failed', error);
		return { ok: false, error };
	}
}
