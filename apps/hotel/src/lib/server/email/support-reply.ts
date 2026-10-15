import { darken } from '$lib/woven-pattern';
import type { RenderedEmail } from './booking-confirmation';

/**
 * The email a guest gets when staff answer a message they left while nobody was online in the
 * Customer Support chat. The guest has no booking page to return to, so the reply itself is the
 * whole message: a quoted question, the answer, and the hotel's name. Woven Ledger email idiom
 * (see `guest-message-reply.ts`). Pure.
 */

export interface SupportReplyEmailData {
	hotel: {
		name: string;
		city: string | null;
		accentColor: string;
		paperColor: string;
	};
	guestName: string;
	/** What the guest wrote, quoted back. */
	originalMessage: string;
	/** The staff answer, plain text. */
	replyBody: string;
	staffName: string;
}

const FONT_DISPLAY = "Georgia, 'Times New Roman', 'Noto Serif', serif";
const FONT_BODY =
	"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = '#3a3227';
const INK_MUTED = '#6b6155';
const RULE = '#dcd4c6';
const DEFAULT_BAND = '#f4f1ea';

const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderSupportReply(data: SupportReplyEmailData): RenderedEmail {
	const { hotel } = data;
	const accent = /^#[0-9a-fA-F]{6}$/.test(hotel.accentColor) ? hotel.accentColor : '#836819';
	const paper = /^#[0-9a-fA-F]{6}$/.test(hotel.paperColor) ? hotel.paperColor : '#ffffff';
	const accentDeep = darken(accent, 0.3);
	const band = paper.toLowerCase() === '#ffffff' ? DEFAULT_BAND : darken(paper, 0.03);

	const subject = `${hotel.name} replied to your message`;
	const place = [hotel.name, hotel.city].filter(Boolean).join(' · ');

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${band};-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${band};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
	<tr><td style="padding:0 4px 16px;border-bottom:6px solid ${accent};">
		<div style="font-family:${FONT_DISPLAY};font-size:22px;font-weight:500;color:${INK};letter-spacing:-0.01em;">${esc(hotel.name)}</div>
	</td></tr>
	<tr><td style="padding:28px 4px 0;">
		<div style="font-family:${FONT_DISPLAY};font-size:24px;font-weight:500;color:${INK};">Thanks for getting in touch</div>
		<div style="margin-top:10px;font-family:${FONT_BODY};font-size:14px;line-height:1.55;color:${INK_MUTED};">${esc(data.guestName)}, ${esc(data.staffName)} from ${esc(hotel.name)} replied to the message you left.</div>
	</td></tr>
	<tr><td style="padding:20px 4px 0;">
		<div style="font-family:${FONT_BODY};font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:${INK_MUTED};">You wrote</div>
		<div style="margin-top:6px;padding:10px 14px;border-left:3px solid ${RULE};font-family:${FONT_BODY};font-size:14px;line-height:1.55;color:${INK_MUTED};white-space:pre-wrap;">${esc(data.originalMessage)}</div>
	</td></tr>
	<tr><td style="padding:20px 4px 0;">
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${RULE};border-radius:4px;">
		<tr><td style="padding:18px 20px;">
			<div style="font-family:${FONT_BODY};font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:${accentDeep};">Our reply</div>
			<div style="margin-top:8px;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:${INK};white-space:pre-wrap;">${esc(data.replyBody)}</div>
		</td></tr>
		</table>
	</td></tr>
	<tr><td style="padding:24px 4px 0;border-top:1px solid ${RULE};margin-top:24px;">
		<div style="font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${INK_MUTED};">${esc(place)}<br />Just reply to this email if you need anything else.</div>
	</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

	const rule = '─'.repeat(48);
	const text = [
		hotel.name.toUpperCase(),
		rule,
		`${data.guestName}, ${data.staffName} from ${hotel.name} replied to the message you left.`,
		'',
		'YOU WROTE',
		data.originalMessage,
		'',
		'OUR REPLY',
		data.replyBody,
		rule,
		place,
		'Just reply to this email if you need anything else.'
	].join('\n');

	return { subject, html, text };
}
