import { darken } from '$lib/woven-pattern';
import type { RenderedEmail } from './booking-confirmation';

/**
 * Notifies a guest that the hotel replied to their message/cancellation request
 * on `/book/manage` — the guest page has no push/polling, so this is the nudge
 * back to it. Woven Ledger email idiom (see `booking-confirmation.ts`), but the
 * plainest variant yet: no ticket, just a quoted reply and one link. Pure;
 * unit-tested.
 */

export interface GuestMessageReplyEmailData {
	hotel: {
		name: string;
		city: string | null;
		logoUrl: string | null;
		accentColor: string;
		paperColor: string;
	};
	guestName: string;
	confirmationCode: string;
	/** The staff reply body, plain text (no HTML in a guest message). */
	replyBody: string;
	/** Absolute URL to `/book/manage/[orderId]?t=...`. */
	manageUrl: string;
}

const FONT_DISPLAY = "Georgia, 'Times New Roman', 'Noto Serif', serif";
const FONT_BODY =
	"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_DATA = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const INK = '#3a3227';
const INK_MUTED = '#6b6155';
const RULE = '#dcd4c6';
const DEFAULT_BAND = '#f4f1ea';

const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderGuestMessageReply(data: GuestMessageReplyEmailData): RenderedEmail {
	const { hotel } = data;
	const accent = /^#[0-9a-fA-F]{6}$/.test(hotel.accentColor) ? hotel.accentColor : '#836819';
	const paper = /^#[0-9a-fA-F]{6}$/.test(hotel.paperColor) ? hotel.paperColor : '#ffffff';
	const accentDeep = darken(accent, 0.3);
	const band = paper.toLowerCase() === '#ffffff' ? DEFAULT_BAND : darken(paper, 0.03);

	const subject = `${hotel.name} replied to your message — ${data.confirmationCode}`;
	const preheader = `${hotel.name} replied about your booking. Reply on your booking page.`;

	const logoImg = hotel.logoUrl
		? `<img src="${esc(hotel.logoUrl)}" alt="${esc(hotel.name)}" height="40" style="display:block;height:40px;width:auto;border:0;margin-bottom:10px;" />`
		: '';

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${band};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${band};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

	<tr><td style="padding:0 4px 16px;border-bottom:1px solid ${RULE};">
		${logoImg}
		<div style="font-family:${FONT_DISPLAY};font-size:22px;font-weight:500;color:${INK};letter-spacing:-0.01em;">${esc(hotel.name)}</div>
	</td></tr>

	<tr><td style="padding:32px 4px 0;">
		<div style="font-family:${FONT_DISPLAY};font-size:26px;font-weight:500;color:${INK};letter-spacing:-0.01em;">The hotel replied</div>
		<div style="margin-top:10px;font-family:${FONT_DATA};font-size:20px;font-weight:700;letter-spacing:2px;color:${accentDeep};">${esc(data.confirmationCode)}</div>
		<div style="margin-top:10px;font-family:${FONT_BODY};font-size:14px;line-height:1.55;color:${INK_MUTED};">${esc(data.guestName)}, ${esc(hotel.name)} replied to your message.</div>
	</td></tr>

	<tr><td style="padding:20px 4px 0;">
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${RULE};border-radius:4px;">
		<tr><td style="padding:18px 20px;">
			<div style="font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${INK};white-space:pre-wrap;">${esc(data.replyBody)}</div>
		</td></tr>
		</table>
	</td></tr>

	<tr><td align="center" style="padding:28px 4px;">
		<!--[if mso]>
		<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(data.manageUrl)}" style="height:46px;v-text-anchor:middle;width:220px;" arcsize="9%" fillcolor="${accent}" strokecolor="${accent}">
		<w:anchorlock/><center style="color:${paper};font-family:sans-serif;font-size:15px;font-weight:bold;">View the conversation</center>
		</v:roundrect>
		<![endif]-->
		<!--[if !mso]><!-- -->
		<a href="${esc(data.manageUrl)}" style="display:inline-block;background:${accent};color:${paper};font-family:${FONT_BODY};font-size:15px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:4px;">View the conversation</a>
		<!--<![endif]-->
	</td></tr>

	<tr><td style="padding:16px 4px 0;border-top:1px solid ${RULE};">
		<div style="font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${INK_MUTED};">
			${esc([hotel.name, hotel.city].filter(Boolean).join(' · '))}<br />
			Booked directly with ${esc(hotel.name)}.
		</div>
	</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

	const rule = '─'.repeat(48);
	const t: string[] = [];
	t.push(hotel.name.toUpperCase());
	t.push(rule);
	t.push('');
	t.push('THE HOTEL REPLIED');
	t.push(`Confirmation code:  ${data.confirmationCode}`);
	t.push(`${data.guestName}, ${hotel.name} replied to your message.`);
	t.push('');
	t.push(rule);
	t.push(data.replyBody);
	t.push(rule);
	t.push('');
	t.push(`View the conversation: ${data.manageUrl}`);
	t.push('');
	t.push(`${[hotel.name, hotel.city].filter(Boolean).join(' - ')}`);

	return { subject, html, text: t.join('\n') };
}
