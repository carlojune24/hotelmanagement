import { darken } from '$lib/woven-pattern';
import type { RenderedEmail } from './booking-confirmation';

/**
 * Post-checkout "how was your stay?" email — the Woven Ledger email idiom (see
 * `booking-confirmation.ts` and apps/hotel/DESIGN.md) applied to a review
 * invitation: same masthead and mono data register, but the frame's only job
 * is a single link out to `leave-review/[bookingId]`. Pure; unit-tested.
 */

export interface ReviewRequestEmailData {
	hotel: {
		name: string;
		city: string | null;
		contactEmail: string | null;
		contactPhone: string | null;
		logoUrl: string | null;
		accentColor: string;
		paperColor: string;
	};
	guestName: string;
	confirmationCode: string;
	/** What they stayed in, e.g. "Deluxe Twin". */
	roomTypeName: string;
	reviewUrl: string;
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

export function renderBookingReviewRequest(data: ReviewRequestEmailData): RenderedEmail {
	const { hotel } = data;
	const accent = /^#[0-9a-fA-F]{6}$/.test(hotel.accentColor) ? hotel.accentColor : '#836819';
	const paper = /^#[0-9a-fA-F]{6}$/.test(hotel.paperColor) ? hotel.paperColor : '#ffffff';
	const accentDeep = darken(accent, 0.3);
	const band = paper.toLowerCase() === '#ffffff' ? DEFAULT_BAND : darken(paper, 0.03);

	const subject = `How was your stay at ${hotel.name}?`;
	const preheader = `${data.guestName}, tell us about your stay in the ${data.roomTypeName}.`;

	const logoImg = hotel.logoUrl
		? `<img src="${esc(hotel.logoUrl)}" alt="${esc(hotel.name)}" height="40" style="display:block;height:40px;width:auto;border:0;margin-bottom:10px;" />`
		: '';
	const contactBits = [hotel.contactEmail, hotel.contactPhone].filter(Boolean).join('  ·  ');

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
		<div style="font-family:${FONT_DISPLAY};font-size:26px;font-weight:500;color:${INK};letter-spacing:-0.01em;">How was your stay?</div>
		<div style="margin-top:10px;font-family:${FONT_DATA};font-size:20px;font-weight:700;letter-spacing:2px;color:${accentDeep};">${esc(data.confirmationCode)}</div>
		<div style="margin-top:10px;font-family:${FONT_BODY};font-size:14px;line-height:1.55;color:${INK_MUTED};">${esc(data.guestName)}, thank you for staying with us in the ${esc(data.roomTypeName)}. We'd love to hear what you thought — it only takes a minute.</div>
	</td></tr>

	<tr><td style="padding:28px 4px 0;">
		<a href="${esc(data.reviewUrl)}" style="display:inline-block;background:${accent};color:${paper};font-family:${FONT_BODY};font-size:15px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:4px;">Leave a review</a>
	</td></tr>

	<tr><td style="padding:24px 4px 28px 4px;margin-top:24px;border-top:1px solid ${RULE};">
		<div style="font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${INK_MUTED};padding-top:20px;">
			If the link above doesn't work, reply to this email${contactBits ? ` or reach ${esc(hotel.name)} at ${esc(contactBits)}` : ''}.
		</div>
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
	t.push('HOW WAS YOUR STAY?');
	t.push(`Confirmation code:  ${data.confirmationCode}`);
	t.push(
		`${data.guestName}, thank you for staying with us in the ${data.roomTypeName}. We'd love to hear what you thought.`
	);
	t.push('');
	t.push(`Leave a review: ${data.reviewUrl}`);
	t.push('');
	t.push(rule);
	t.push(`${[hotel.name, hotel.city].filter(Boolean).join(' - ')}`);
	if (contactBits) t.push(contactBits.replace(/·/g, '-'));

	return { subject, html, text: t.join('\n') };
}
