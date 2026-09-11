import { darken } from '$lib/woven-pattern';
import type { RenderedEmail } from './booking-confirmation';

/**
 * Guest booking-cancellation email — the Woven Ledger email idiom (see
 * `booking-confirmation.ts` and apps/hotel/DESIGN.md) applied to a cancellation
 * notice rather than a keepsake ticket: same masthead, warm ground, flat-accent
 * frame and mono data register, but a shorter, plainer body. Pure; unit-tested.
 */

export interface CancellationEmailData {
	hotel: {
		name: string;
		city: string | null;
		contactEmail: string | null;
		contactPhone: string | null;
		logoUrl: string | null;
		accentColor: string;
		paperColor: string;
		currency: string;
	};
	guestName: string;
	confirmationCode: string;
	/** The line that was cancelled, e.g. "Deluxe Twin" or "Grand Ballroom · Wedding". */
	cancelledLabel: string;
	/** True once every line under the order is cancelled. */
	orderFullyCancelled: boolean;
	feeCentavos: number;
	refundCentavos: number;
	/** Human label for the refund tender, e.g. "GCash". Only shown when a refund applies. */
	refundMethodLabel: string | null;
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

export function renderBookingCancellation(data: CancellationEmailData): RenderedEmail {
	const { hotel } = data;
	const accent = /^#[0-9a-fA-F]{6}$/.test(hotel.accentColor) ? hotel.accentColor : '#836819';
	const paper = /^#[0-9a-fA-F]{6}$/.test(hotel.paperColor) ? hotel.paperColor : '#ffffff';
	const accentDeep = darken(accent, 0.3);
	const band = paper.toLowerCase() === '#ffffff' ? DEFAULT_BAND : darken(paper, 0.03);
	const currency = hotel.currency || 'PHP';
	const hasRefund = data.refundCentavos > 0;

	const subject = `Booking cancelled at ${hotel.name} — ${data.confirmationCode}`;
	const preheader = data.orderFullyCancelled
		? `Your reservation at ${hotel.name} has been cancelled.`
		: `Part of your reservation at ${hotel.name} has been cancelled.`;

	const row = (label: string, value: string, opts: { emphasis?: boolean } = {}) => `
		<tr>
			<td style="padding:7px 0;vertical-align:top;font-family:${FONT_DATA};font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${INK_MUTED};white-space:nowrap;">${esc(label)}</td>
			<td style="padding:7px 0 7px 16px;vertical-align:top;text-align:right;font-family:${FONT_DATA};font-size:${opts.emphasis ? '14px' : '13px'};font-weight:${opts.emphasis ? 700 : 400};color:${INK};">${esc(value)}</td>
		</tr>`;
	const ruleRow = `<tr><td colspan="2" style="padding:8px 0;"><div style="height:1px;line-height:1px;font-size:0;background:${RULE};">&nbsp;</div></td></tr>`;

	const manifest =
		row('Booking', data.cancelledLabel) +
		row('Confirmation', data.confirmationCode) +
		ruleRow +
		(data.feeCentavos > 0 ? row('Cancellation fee', money(data.feeCentavos, currency)) : '') +
		(hasRefund
			? row('Refund', `${money(data.refundCentavos, currency)}`, { emphasis: true }) +
				(data.refundMethodLabel
					? `<tr><td colspan="2" style="padding:0 0 4px;text-align:right;font-family:${FONT_BODY};font-size:12px;color:${INK_MUTED};">via ${esc(data.refundMethodLabel)}</td></tr>`
					: '')
			: row('Refund', 'None'));

	const logoImg = hotel.logoUrl
		? `<img src="${esc(hotel.logoUrl)}" alt="${esc(hotel.name)}" height="40" style="display:block;height:40px;width:auto;border:0;margin-bottom:10px;" />`
		: '';
	const contactBits = [hotel.contactEmail, hotel.contactPhone].filter(Boolean).join('  ·  ');

	const bodyLine = data.orderFullyCancelled
		? `${esc(data.guestName)}, your reservation has been cancelled.`
		: `${esc(data.guestName)}, one part of your reservation has been cancelled. The rest of your booking still stands.`;
	const refundNote = hasRefund
		? `Your refund of <strong style="color:${INK};">${esc(money(data.refundCentavos, currency))}</strong>${data.refundMethodLabel ? ` via ${esc(data.refundMethodLabel)}` : ''} is being processed. Please allow 5–10 business days for it to reach you.`
		: data.feeCentavos > 0
			? `Under the rate's cancellation terms, no amount is refundable for this booking.`
			: `No payment was taken for this booking, so there is nothing to refund.`;

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
		<div style="font-family:${FONT_DISPLAY};font-size:26px;font-weight:500;color:${INK};letter-spacing:-0.01em;">${data.orderFullyCancelled ? 'Reservation cancelled' : 'Booking updated'}</div>
		<div style="margin-top:10px;font-family:${FONT_DATA};font-size:20px;font-weight:700;letter-spacing:2px;color:${accentDeep};">${esc(data.confirmationCode)}</div>
		<div style="margin-top:10px;font-family:${FONT_BODY};font-size:14px;line-height:1.55;color:${INK_MUTED};">${bodyLine}</div>
	</td></tr>

	<tr><td style="padding:24px 0 0;">
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${accent}" style="background:${accent};border-radius:4px;">
		<tr><td style="padding:6px;">
			<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${paper}" style="background:${paper};border-radius:2px;">
			<tr><td style="padding:22px 24px;">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${manifest}</table>
			</td></tr>
			</table>
		</td></tr>
		</table>
	</td></tr>

	<tr><td style="padding:24px 4px 0;">
		<div style="font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${INK};">${refundNote}</div>
	</td></tr>

	<tr><td style="padding:24px 4px 28px 4px;margin-top:24px;border-top:1px solid ${RULE};">
		<div style="font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${INK_MUTED};padding-top:20px;">
			If you have any questions about this cancellation, reply to this email${contactBits ? ` or reach ${esc(hotel.name)} at ${esc(contactBits)}` : ''}.
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
	t.push(data.orderFullyCancelled ? 'RESERVATION CANCELLED' : 'BOOKING UPDATED');
	t.push(`Confirmation code:  ${data.confirmationCode}`);
	t.push(bodyLine.replace(/<[^>]+>/g, ''));
	t.push('');
	t.push(rule);
	t.push(`Booking       ${data.cancelledLabel}`);
	if (data.feeCentavos > 0) t.push(`Cancel fee    ${money(data.feeCentavos, currency)}`);
	t.push(
		hasRefund
			? `Refund        ${money(data.refundCentavos, currency)}${data.refundMethodLabel ? ` (via ${data.refundMethodLabel})` : ''}`
			: `Refund        None`
	);
	t.push(rule);
	t.push('');
	t.push(refundNote.replace(/<[^>]+>/g, ''));
	t.push('');
	t.push(`${[hotel.name, hotel.city].filter(Boolean).join(' - ')}`);
	if (contactBits) t.push(contactBits.replace(/·/g, '-'));

	return { subject, html, text: t.join('\n') };
}
