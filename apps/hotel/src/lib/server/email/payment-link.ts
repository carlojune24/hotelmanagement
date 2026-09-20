import { darken } from '$lib/woven-pattern';
import type { RenderedEmail } from './booking-confirmation';

/**
 * "Finish your booking" email for a guest who left checkout before paying: a link straight back to
 * the payment step, what is due, and when the hold on the room(s) lapses. Woven Ledger email idiom
 * (masthead, warm ground, flat-accent button, mono figures), shorter than the confirmation.
 * Pure; unit-tested.
 */
export interface PaymentLinkEmailData {
	hotel: {
		name: string;
		city: string | null;
		contactEmail: string | null;
		contactPhone: string | null;
		accentColor: string;
		paperColor: string;
		currency: string;
	};
	guestName: string;
	confirmationCode: string;
	/** What is being held, e.g. ["Deluxe Twin × 2", "Grand Ballroom · Wedding"]. */
	lines: string[];
	totalCentavos: number;
	/** What the guest pays now (the downpayment, or the total). */
	dueNowCentavos: number;
	/** Absolute link to the review & payment page (carries the order token). */
	payUrl: string;
	/** When the hold lapses if unpaid, already formatted for the hotel's timezone. */
	holdUntil: string;
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
const money = (centavos: number, currency: string) => {
	const n = (centavos / 100).toLocaleString('en-PH', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
	return currency === 'PHP' ? `₱${n}` : `${currency} ${n}`;
};

export function renderPaymentLink(data: PaymentLinkEmailData): RenderedEmail {
	const { hotel } = data;
	const accent = /^#[0-9a-fA-F]{6}$/.test(hotel.accentColor) ? hotel.accentColor : '#836819';
	const paper = /^#[0-9a-fA-F]{6}$/.test(hotel.paperColor) ? hotel.paperColor : '#ffffff';
	const accentDeep = darken(accent, 0.3);
	const band = paper.toLowerCase() === '#ffffff' ? DEFAULT_BAND : darken(paper, 0.03);
	const cur = hotel.currency;
	const partial = data.dueNowCentavos < data.totalCentavos;

	const subject = `Finish your booking at ${hotel.name} — ${data.confirmationCode}`;
	const dueLine = partial
		? `${money(data.dueNowCentavos, cur)} now (the rest of ${money(data.totalCentavos, cur)} is paid at the hotel)`
		: `${money(data.totalCentavos, cur)}`;

	const linesHtml = data.lines
		.map(
			(l) =>
				`<tr><td style="padding:6px 0;border-top:1px solid ${RULE};font-family:${FONT_BODY};font-size:14px;color:${INK};">${esc(l)}</td></tr>`
		)
		.join('');
	const contact = [hotel.contactEmail, hotel.contactPhone].filter(Boolean).join('  ·  ');

	const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${band};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${band};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${paper};border:1px solid ${RULE};">
<tr><td style="height:6px;background:${accent};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 8px;">
	<div style="font-family:${FONT_DISPLAY};font-size:22px;color:${accentDeep};">${esc(hotel.name)}</div>
	<div style="margin-top:14px;font-family:${FONT_DISPLAY};font-size:26px;line-height:1.2;color:${INK};">Finish your booking</div>
	<div style="margin-top:10px;font-family:${FONT_BODY};font-size:14px;line-height:1.55;color:${INK_MUTED};">${esc(data.guestName)}, your booking was started but not paid, so it isn't confirmed yet. Your room${data.lines.length === 1 ? ' is' : 's are'} held for you until <strong style="color:${INK};">${esc(data.holdUntil)}</strong>.</div>
</td></tr>
<tr><td style="padding:8px 28px;">
	<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${linesHtml}
	<tr><td style="padding:10px 0 0;border-top:1px solid ${INK};font-family:${FONT_BODY};font-size:14px;color:${INK};">Due now: <span style="font-family:${FONT_DATA};font-weight:600;">${esc(dueLine)}</span></td></tr>
	<tr><td style="padding:4px 0;font-family:${FONT_DATA};font-size:12px;color:${INK_MUTED};">Booking ${esc(data.confirmationCode)}</td></tr></table>
</td></tr>
<tr><td align="center" style="padding:20px 28px 8px;">
	<a href="${esc(data.payUrl)}" style="display:inline-block;background:${accent};color:${paper};font-family:${FONT_BODY};font-size:15px;font-weight:600;text-decoration:none;padding:13px 26px;">Continue to payment</a>
</td></tr>
<tr><td style="padding:8px 28px 24px;font-family:${FONT_BODY};font-size:12px;line-height:1.5;color:${INK_MUTED};">
	If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all;">${esc(data.payUrl)}</span><br><br>
	If the hold lapses, just book again on our website — nothing has been charged.${contact ? `<br>${esc(contact)}` : ''}
</td></tr>
</table></td></tr></table></body></html>`;

	const text = [
		`${hotel.name.toUpperCase()}`,
		'',
		'FINISH YOUR BOOKING',
		`${data.guestName}, your booking was started but not paid, so it isn't confirmed yet.`,
		`Your room${data.lines.length === 1 ? ' is' : 's are'} held until ${data.holdUntil}.`,
		'',
		...data.lines.map((l) => `- ${l}`),
		`Due now: ${dueLine}`,
		`Booking ${data.confirmationCode}`,
		'',
		'Continue to payment:',
		data.payUrl,
		'',
		"If the hold lapses, just book again on our website — nothing has been charged.",
		contact.replace(/·/g, '-')
	]
		.filter((l, i, a) => !(l === '' && a[i - 1] === ''))
		.join('\n');

	return { subject, html, text };
}
