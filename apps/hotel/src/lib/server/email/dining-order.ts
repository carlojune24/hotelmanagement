import { darken } from '$lib/woven-pattern';
import type { RenderedEmail } from './booking-confirmation';

/** Guest emails for an online dining order: a confirmation, and a "ready" notice. Pure;
 *  `sendDiningOrderEmail` gathers the data and sends. */
export interface DiningOrderEmailData {
	kind: 'confirmation' | 'ready';
	hotel: {
		name: string;
		city: string | null;
		address: string | null;
		contactEmail: string | null;
		contactPhone: string | null;
		logoUrl: string | null;
		accentColor: string;
		paperColor: string;
	};
	guestName: string;
	venueTitle: string;
	code: string;
	/** 'takeaway' (collect it) or 'pre_order' (served at the table). */
	orderType: string;
	/** Already formatted in the hotel's timezone, e.g. "Sat, Oct 10" and "7:30 PM". Null when none. */
	pickupDateLabel: string | null;
	pickupTimeLabel: string | null;
	items: { name: string; quantity: number; addons: string[]; remarks: string | null; lineTotalCentavos: number }[];
	totalCentavos: number;
	/** 'paid' (online or at the cashier), or 'pay_at_venue'. */
	payment: 'paid' | 'pay_at_venue';
	remarks: string | null;
	/** Where and how to collect, set by the hotel per venue. Shown for takeaway only. */
	pickupNote?: string | null;
	/** Absolute link to the guest's tracking page. */
	trackUrl: string;
}

const FONT_DISPLAY = "Georgia, 'Times New Roman', 'Noto Serif', serif";
const FONT_BODY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_DATA = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const INK = '#3a3227';
const INK_MUTED = '#6b6155';
const RULE = '#dcd4c6';
const DEFAULT_BAND = '#f4f1ea';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function renderDiningOrder(data: DiningOrderEmailData): RenderedEmail {
	const { hotel } = data;
	const accent = /^#[0-9a-fA-F]{6}$/.test(hotel.accentColor) ? hotel.accentColor : '#836819';
	const paper = /^#[0-9a-fA-F]{6}$/.test(hotel.paperColor) ? hotel.paperColor : '#ffffff';
	const accentDeep = darken(accent, 0.3);
	const band = paper.toLowerCase() === '#ffffff' ? DEFAULT_BAND : darken(paper, 0.03);
	const ready = data.kind === 'ready';
	const dineIn = data.orderType === 'pre_order';

	const headline = ready ? (dineIn ? 'Your order is ready to serve' : 'Your order is ready for pickup') : 'We have your order';
	const subject = ready ? `Your order ${data.code} is ready: ${hotel.name}` : `Order ${data.code} confirmed: ${data.venueTitle}`;
	const lead = ready
		? dineIn
			? 'It will be brought to your table.'
			: 'Please come to the restaurant to collect it. We kept it warm for you.'
		: data.payment === 'paid'
			? 'Your payment is confirmed and the kitchen has your order.'
			: 'The kitchen has your order. Please pay when you collect it.';
	const pickupNote = !dineIn && data.pickupNote ? data.pickupNote : null;
	const when = data.pickupTimeLabel ? `${data.pickupDateLabel ? `${data.pickupDateLabel}, ` : ''}${data.pickupTimeLabel}` : null;

	const itemRows = data.items
		.map(
			(i) => `
		<tr>
			<td style="padding:8px 0;border-bottom:1px solid ${RULE};font-family:${FONT_BODY};font-size:14px;color:${INK};">
				${i.quantity}× ${esc(i.name)}${i.addons.length ? `<div style="font-size:12px;color:${INK_MUTED};">+ ${esc(i.addons.join(', '))}</div>` : ''}${i.remarks ? `<div style="font-size:12px;color:${INK_MUTED};font-style:italic;">“${esc(i.remarks)}”</div>` : ''}
			</td>
			<td style="padding:8px 0 8px 12px;border-bottom:1px solid ${RULE};text-align:right;vertical-align:top;font-family:${FONT_DATA};font-size:13px;color:${INK};white-space:nowrap;">${esc(peso(i.lineTotalCentavos))}</td>
		</tr>`
		)
		.join('');

	const contactBits = [hotel.contactPhone, hotel.contactEmail].filter(Boolean).join('  ·  ');
	const logoImg = hotel.logoUrl
		? `<img src="${esc(hotel.logoUrl)}" alt="${esc(hotel.name)}" height="40" style="display:block;height:40px;width:auto;border:0;margin-bottom:10px;" />`
		: '';

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${band};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(`${headline}. Order ${data.code}.`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${band};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
	<tr><td style="padding:0 4px 16px;border-bottom:1px solid ${RULE};">
		${logoImg}
		<div style="font-family:${FONT_DISPLAY};font-size:22px;font-weight:500;color:${INK};">${esc(hotel.name)}</div>
	</td></tr>
	<tr><td style="padding:32px 4px 0;">
		<div style="font-family:${FONT_DISPLAY};font-size:26px;font-weight:500;color:${INK};">${esc(headline)}</div>
		<div style="margin-top:10px;font-family:${FONT_DATA};font-size:20px;font-weight:700;letter-spacing:2px;color:${accentDeep};">${esc(data.code)}</div>
		<div style="margin-top:10px;font-family:${FONT_BODY};font-size:14px;line-height:1.55;color:${INK_MUTED};">${esc(data.guestName)}, ${esc(lead)}${when ? ` ${dineIn ? 'Table time' : 'Pickup'}: <strong style="color:${INK};">${esc(when)}</strong>.` : ''}</div>
	</td></tr>
	<tr><td style="padding:24px 0 0;">
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${accent}" style="background:${accent};border-radius:4px 4px 10px 10px;">
			<tr><td style="padding:6px;">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${paper}" style="background:${paper};border-radius:2px 2px 6px 6px;">
					<tr><td style="padding:20px 22px;">
						<div style="font-family:${FONT_DATA};font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${INK_MUTED};">${esc(data.venueTitle)}</div>
						<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">${itemRows}
							<tr>
								<td style="padding:12px 0 0;font-family:${FONT_BODY};font-size:15px;font-weight:600;color:${INK};">Total <span style="font-weight:400;font-size:12px;color:${INK_MUTED};">VAT included</span></td>
								<td style="padding:12px 0 0;text-align:right;font-family:${FONT_DATA};font-size:15px;font-weight:700;color:${INK};white-space:nowrap;">${esc(peso(data.totalCentavos))}</td>
							</tr>
							<tr><td colspan="2" style="padding:4px 0 0;font-family:${FONT_BODY};font-size:12px;color:${INK_MUTED};">${data.payment === 'paid' ? 'Paid' : 'To pay at the restaurant'}</td></tr>
						</table>
						${data.remarks ? `<div style="margin-top:12px;font-family:${FONT_BODY};font-size:12px;color:${INK_MUTED};">Note: ${esc(data.remarks)}</div>` : ''}
						${pickupNote ? `<div style="margin-top:12px;font-family:${FONT_BODY};font-size:13px;color:${INK};">${esc(pickupNote)}</div>` : ''}
					</td></tr>
				</table>
			</td></tr>
		</table>
	</td></tr>
	<tr><td style="padding:24px 4px 0;">
		<a href="${esc(data.trackUrl)}" style="display:inline-block;padding:13px 22px;background:${accent};color:${paper};font-family:${FONT_BODY};font-size:14px;font-weight:600;text-decoration:none;border-radius:4px;">Track your order</a>
	</td></tr>
	<tr><td style="padding:28px 4px 0;font-family:${FONT_BODY};font-size:12px;line-height:1.6;color:${INK_MUTED};">
		${esc([hotel.address, hotel.city].filter(Boolean).join(', '))}${contactBits ? `<br />${esc(contactBits)}` : ''}
	</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

	const text = [
		headline,
		`Order: ${data.code}`,
		`${data.venueTitle}`,
		'',
		lead,
		...(when ? [`${dineIn ? 'Table time' : 'Pickup'}: ${when}`] : []),
		'',
		...data.items.flatMap((i) => [
			`${i.quantity}x ${i.name}  ${peso(i.lineTotalCentavos)}`,
			...(i.addons.length ? [`   + ${i.addons.join(', ')}`] : []),
			...(i.remarks ? [`   "${i.remarks}"`] : [])
		]),
		`Total (VAT included): ${peso(data.totalCentavos)}`,
		data.payment === 'paid' ? 'Paid' : 'To pay at the restaurant',
		...(data.remarks ? ['', `Note: ${data.remarks}`] : []),
		...(pickupNote ? ['', pickupNote] : []),
		'',
		`Track your order: ${data.trackUrl}`,
		'',
		hotel.name,
		[hotel.address, hotel.city].filter(Boolean).join(', '),
		contactBits
	]
		.filter((l, i, a) => l !== '' || a[i - 1] !== '')
		.join('\n');

	return { subject, html, text };
}
