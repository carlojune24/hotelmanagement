import { darken } from '$lib/woven-pattern';
import type { RenderedEmail } from './booking-confirmation';

/**
 * The two emails that keep a guest in the loop while a payment is being confirmed, in the Woven Ledger email
 * idiom (masthead, warm ground, flat-accent button, mono figures):
 *
 *  - `tracking`: sent when the guest starts paying. The booking code, what is due, and a link they can come back to
 *    at any time (it works after a refresh, on another phone, days later).
 *  - `delayed`: sent once if PayMongo has not confirmed after a while: "your payment is safe, do not pay again, we keep
 *    checking, here is your link".
 *
 * Pure; unit-testable.
 */
export interface PaymentStatusEmailData {
	kind: 'tracking' | 'delayed';
	hotel: {
		name: string;
		contactEmail: string | null;
		contactPhone: string | null;
		accentColor: string;
		paperColor: string;
		currency: string;
	};
	guestName: string;
	/** The booking / order code the guest will quote (`210DA6C8`, `DN-7K4Q`). */
	reference: string;
	/** The payment check code, `PC-…`: what the front desk can search. */
	checkCode: string;
	amountCentavos: number;
	/** Absolute link to the page that always shows where this payment stands. */
	trackUrl: string;
	/** When the hold lapses if unpaid, formatted for the hotel's timezone (rooms only). */
	holdUntil: string | null;
}

const FONT_DISPLAY = "Georgia, 'Times New Roman', 'Noto Serif', serif";
const FONT_BODY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_DATA = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const INK = '#3a3227';
const INK_MUTED = '#6b6155';
const RULE = '#dcd4c6';
const DEFAULT_BAND = '#f4f1ea';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (centavos: number, currency: string) => {
	const n = (centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	return currency === 'PHP' ? `₱${n}` : `${currency} ${n}`;
};

export function renderPaymentStatus(data: PaymentStatusEmailData): RenderedEmail {
	const { hotel } = data;
	const accent = /^#[0-9a-fA-F]{6}$/.test(hotel.accentColor) ? hotel.accentColor : '#836819';
	const paper = /^#[0-9a-fA-F]{6}$/.test(hotel.paperColor) ? hotel.paperColor : '#ffffff';
	const accentDeep = darken(accent, 0.3);
	const band = paper.toLowerCase() === '#ffffff' ? DEFAULT_BAND : darken(paper, 0.03);
	const amount = money(data.amountCentavos, hotel.currency);
	const contact = [hotel.contactEmail, hotel.contactPhone].filter(Boolean).join('  ·  ');
	const delayed = data.kind === 'delayed';

	const subject = delayed
		? `Still checking your payment at ${hotel.name} — ${data.reference}`
		: `Track your payment at ${hotel.name} — ${data.reference}`;
	const heading = delayed ? 'We are still checking your payment' : 'Track your payment';
	const intro = delayed
		? `${data.guestName}, PayMongo has not confirmed your payment yet. <strong style="color:${INK};">If you already paid, please do not pay again.</strong> Your payment is safe: we keep checking with PayMongo automatically and will email you the moment it is confirmed.`
		: `${data.guestName}, we are waiting for PayMongo to confirm your payment. You can close the payment page: this email's link always shows where it stands, and we will email you again once it is confirmed.${data.holdUntil ? ` Your booking is held until <strong style="color:${INK};">${esc(data.holdUntil)}</strong>.` : ''}`;
	const button = delayed ? 'Check my payment' : 'Track my payment';

	const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${band};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${band};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${paper};border:1px solid ${RULE};">
<tr><td style="height:6px;background:${accent};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 8px;">
	<div style="font-family:${FONT_DISPLAY};font-size:22px;color:${accentDeep};">${esc(hotel.name)}</div>
	<div style="margin-top:14px;font-family:${FONT_DISPLAY};font-size:26px;line-height:1.2;color:${INK};">${esc(heading)}</div>
	<div style="margin-top:10px;font-family:${FONT_BODY};font-size:14px;line-height:1.55;color:${INK_MUTED};">${intro}</div>
</td></tr>
<tr><td style="padding:8px 28px;">
	<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
	<tr><td style="padding:10px 0;border-top:1px solid ${INK};font-family:${FONT_BODY};font-size:14px;color:${INK};">Amount: <span style="font-family:${FONT_DATA};font-weight:600;">${esc(amount)}</span></td></tr>
	<tr><td style="padding:4px 0;font-family:${FONT_DATA};font-size:12px;color:${INK_MUTED};">Booking ${esc(data.reference)}</td></tr>
	<tr><td style="padding:4px 0 8px;font-family:${FONT_DATA};font-size:12px;color:${INK_MUTED};">Payment check code ${esc(data.checkCode)}</td></tr></table>
</td></tr>
<tr><td align="center" style="padding:16px 28px 8px;">
	<a href="${esc(data.trackUrl)}" style="display:inline-block;background:${accent};color:${paper};font-family:${FONT_BODY};font-size:15px;font-weight:600;text-decoration:none;padding:13px 26px;">${esc(button)}</a>
</td></tr>
<tr><td style="padding:8px 28px 24px;font-family:${FONT_BODY};font-size:12px;line-height:1.5;color:${INK_MUTED};">
	If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all;">${esc(data.trackUrl)}</span><br><br>
	Keep this email: the link and the codes above are all anyone needs to find your payment.${contact ? `<br>${esc(contact)}` : ''}
</td></tr>
</table></td></tr></table></body></html>`;

	const text = [
		hotel.name.toUpperCase(),
		'',
		heading.toUpperCase(),
		delayed
			? `${data.guestName}, PayMongo has not confirmed your payment yet. If you already paid, please do not pay again. Your payment is safe: we keep checking automatically and will email you the moment it is confirmed.`
			: `${data.guestName}, we are waiting for PayMongo to confirm your payment. You can close the payment page; the link below always shows where it stands, and we will email you again once it is confirmed.${data.holdUntil ? ` Your booking is held until ${data.holdUntil}.` : ''}`,
		'',
		`Amount: ${amount}`,
		`Booking ${data.reference}`,
		`Payment check code ${data.checkCode}`,
		'',
		`${button}:`,
		data.trackUrl,
		'',
		'Keep this email: the link and the codes above are all anyone needs to find your payment.',
		contact.replace(/·/g, '-')
	]
		.filter((l, i, a) => !(l === '' && a[i - 1] === ''))
		.join('\n');

	return { subject, html, text };
}
