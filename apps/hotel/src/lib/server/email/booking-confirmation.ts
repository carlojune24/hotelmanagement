import { darken } from '$lib/woven-pattern';

/**
 * Guest booking-confirmation email — the "Woven Ledger" Confirmation Ticket
 * (apps/hotel/DESIGN.md) relocated from the confirmation screen to the inbox.
 * `renderBookingConfirmation` is pure and unit-tested; `sendBookingConfirmation`
 * (below) gathers the data and hands it to the transport.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfirmationRoomLine {
	roomTypeName: string;
	ratePlanName: string;
	quantity: number;
	checkIn: string; // ISO date, e.g. "2026-11-03"
	checkOut: string;
}

export interface ConfirmationHallLine {
	hallName: string;
	eventType: string;
	eventDate: string; // ISO date
	startTime: string; // "HH:MM:SS"
	endTime: string;
}

export interface BookingConfirmationData {
	hotel: {
		name: string;
		city: string | null;
		/** `branding.contactAddress`, free text. */
		address: string | null;
		contactEmail: string | null;
		contactPhone: string | null;
		/** Absolute URL to the hotel's own logo, or null. */
		logoUrl: string | null;
		checkInTime: string; // "14:00:00"
		checkOutTime: string; // "12:00:00"
		accentColor: string; // "#RRGGBB"
		paperColor: string; // "#RRGGBB"
		currency: string; // "PHP"
	};
	guestName: string;
	confirmationCode: string;
	roomLines: ConfirmationRoomLine[];
	hallLines: ConfirmationHallLine[];
	subtotalCentavos: number;
	feesCentavos: number;
	vatCentavos: number;
	totalCentavos: number;
	/** Absolute URL of the guest's confirmation page (carries the order token). */
	manageUrl: string;
	/** Absolute URL of `/book/manage/[orderId]` — request a cancellation or ask
	 *  the hotel a question (carries the order token). */
	manageBookingUrl: string;
}

export interface RenderedEmail {
	subject: string;
	html: string;
	text: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers (pure)
// ---------------------------------------------------------------------------

const money = (centavos: number, currency: string) => {
	const n = (centavos / 100).toLocaleString('en-PH', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
	return currency === 'PHP' ? `₱${n}` : `${currency} ${n}`;
};

const fmtDate = (iso: string) =>
	new Date(`${iso}T00:00:00`).toLocaleDateString('en-PH', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

const fmtTime = (hms: string) => {
	const [h = 0, m = 0] = hms.split(':').map(Number);
	const period = h < 12 ? 'AM' : 'PM';
	const h12 = h % 12 === 0 ? 12 : h % 12;
	return `${h12}:${String(m).padStart(2, '0')} ${period}`;
};

export const nightsBetween = (checkIn: string, checkOut: string) =>
	Math.max(0, Math.round((+new Date(checkOut) - +new Date(checkIn)) / 86_400_000));

/** Longest stay across the room lines (0 for a hall-only booking). */
export const stayNights = (rooms: ConfirmationRoomLine[]) =>
	rooms.reduce((max, r) => Math.max(max, nightsBetween(r.checkIn, r.checkOut)), 0);

const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const FONT_DISPLAY = "Georgia, 'Times New Roman', 'Noto Serif', serif";
const FONT_BODY =
	"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_DATA = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const INK = '#3a3227';
const INK_MUTED = '#6b6155'; // ≥4.5:1 on both the white ticket and the warm body ground
const RULE = '#dcd4c6';
/** Warm off-white body ground for the default (pure-white) paper — keeps this
 *  world's warm register instead of the cool gray a plain darken() would give. */
const DEFAULT_BAND = '#f4f1ea';

export function renderBookingConfirmation(data: BookingConfirmationData): RenderedEmail {
	const { hotel } = data;
	const accent = /^#[0-9a-fA-F]{6}$/.test(hotel.accentColor) ? hotel.accentColor : '#836819';
	const paper = /^#[0-9a-fA-F]{6}$/.test(hotel.paperColor) ? hotel.paperColor : '#ffffff';
	const accentDeep = darken(accent, 0.3);
	const band = paper.toLowerCase() === '#ffffff' ? DEFAULT_BAND : darken(paper, 0.03);
	const nights = stayNights(data.roomLines);
	const firstRoom = data.roomLines[0];
	const currency = hotel.currency || 'PHP';

	const subject = `Booking confirmed at ${hotel.name} — ${data.confirmationCode}`;

	// ---- manifest rows inside the ticket ----
	const row = (label: string, value: string, opts: { emphasis?: boolean } = {}) => `
		<tr>
			<td style="padding:7px 0;vertical-align:top;font-family:${FONT_DATA};font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${INK_MUTED};white-space:nowrap;">${esc(label)}</td>
			<td style="padding:7px 0 7px 16px;vertical-align:top;text-align:right;font-family:${FONT_DATA};font-size:${opts.emphasis ? '14px' : '13px'};font-weight:${opts.emphasis ? 700 : 400};color:${INK};">${value}</td>
		</tr>`;

	const subline = (text: string) => `
		<tr><td colspan="2" style="padding:0 0 4px;text-align:right;font-family:${FONT_BODY};font-size:12px;color:${INK_MUTED};">${esc(text)}</td></tr>`;

	const ruleRow = `<tr><td colspan="2" style="padding:8px 0;"><div style="height:1px;line-height:1px;font-size:0;background:${RULE};">&nbsp;</div></td></tr>`;

	const stayRows =
		nights > 0 && firstRoom
			? row('Check-in', esc(fmtDate(firstRoom.checkIn))) +
				row('Check-out', esc(fmtDate(firstRoom.checkOut))) +
				subline(`from ${fmtTime(hotel.checkInTime)}  ·  by ${fmtTime(hotel.checkOutTime)}`) +
				row('Nights', String(nights))
			: '';

	const roomRows = data.roomLines
		.map((r) => {
			const qty = r.quantity > 1 ? `  ×${r.quantity}` : '';
			const main = row('Room', `${esc(r.roomTypeName)} — ${esc(r.ratePlanName)}${qty}`);
			const sub =
				data.roomLines.length > 1 ? subline(`${fmtDate(r.checkIn)} – ${fmtDate(r.checkOut)}`) : '';
			return main + sub;
		})
		.join('');

	const hallRows = data.hallLines
		.map(
			(h) =>
				row('Function hall', esc(h.hallName)) +
				subline(
					`${h.eventType} · ${fmtDate(h.eventDate)} · ${fmtTime(h.startTime)}–${fmtTime(h.endTime)}`
				)
		)
		.join('');

	const ticketRows =
		row('Guest', esc(data.guestName)) +
		stayRows +
		(roomRows || hallRows ? ruleRow : '') +
		roomRows +
		hallRows +
		ruleRow +
		row('Total paid', money(data.totalCentavos, currency), { emphasis: true }) +
		row('Confirmation', esc(data.confirmationCode));

	// ---- price breakdown below the ticket ----
	const priceRow = (label: string, value: string, opts: { total?: boolean } = {}) => `
		<tr>
			<td style="padding:${opts.total ? '12px' : '6px'} 0 6px;border-top:${opts.total ? `1px solid ${INK}` : '0'};font-family:${FONT_BODY};font-size:${opts.total ? '15px' : '13px'};font-weight:${opts.total ? 600 : 400};color:${opts.total ? INK : INK_MUTED};">${esc(label)}</td>
			<td style="padding:${opts.total ? '12px' : '6px'} 0 6px;border-top:${opts.total ? `1px solid ${INK}` : '0'};text-align:right;font-family:${FONT_DATA};font-size:${opts.total ? '15px' : '13px'};font-weight:${opts.total ? 700 : 400};color:${INK};">${value}</td>
		</tr>`;

	const breakdown =
		priceRow('Subtotal', money(data.subtotalCentavos, currency)) +
		(data.feesCentavos > 0 ? priceRow('Fees', money(data.feesCentavos, currency)) : '') +
		priceRow('VAT', money(data.vatCentavos, currency)) +
		priceRow('Total paid', money(data.totalCentavos, currency), { total: true });

	const logoImg = hotel.logoUrl
		? `<img src="${esc(hotel.logoUrl)}" alt="${esc(hotel.name)}" height="40" style="display:block;height:40px;width:auto;border:0;margin-bottom:10px;" />`
		: '';

	const addressBits = [hotel.address, hotel.city].filter(Boolean).join(', ');
	const contactBits = [hotel.contactEmail, hotel.contactPhone].filter(Boolean).join('  ·  ');

	const preheader = `Your stay at ${hotel.name} is confirmed${nights > 0 && firstRoom ? `, arriving ${fmtDate(firstRoom.checkIn)}` : ''}.`;

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

	<!-- masthead -->
	<tr><td style="padding:0 4px 16px;border-bottom:1px solid ${RULE};">
		${logoImg}
		<div style="font-family:${FONT_DISPLAY};font-size:22px;font-weight:500;color:${INK};letter-spacing:-0.01em;">${esc(hotel.name)}</div>
	</td></tr>

	<!-- confirmation line -->
	<tr><td style="padding:32px 4px 0;">
		<div style="font-family:${FONT_DISPLAY};font-size:26px;font-weight:500;color:${INK};letter-spacing:-0.01em;">Reservation confirmed</div>
		<div style="margin-top:10px;font-family:${FONT_DATA};font-size:20px;font-weight:700;letter-spacing:2px;color:${accentDeep};">${esc(data.confirmationCode)}</div>
		<div style="margin-top:10px;font-family:${FONT_BODY};font-size:14px;line-height:1.55;color:${INK_MUTED};">${esc(data.guestName)}, your stay is booked and paid in full.</div>
	</td></tr>

	<!-- the ticket -->
	<tr><td style="padding:24px 0 0;">
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${accent}" style="background:${accent};border-radius:4px 4px 10px 10px;">
		<tr><td style="padding:6px;">
			<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${paper}" style="background:${paper};border-radius:2px 2px 8px 8px;">
			<tr><td style="padding:22px 24px;">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
					${ticketRows}
				</table>
			</td></tr>
			</table>
		</td></tr>
		</table>
	</td></tr>

	<!-- price breakdown -->
	<tr><td style="padding:24px 4px 0;">
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
			${breakdown}
		</table>
		<div style="margin-top:8px;font-family:${FONT_BODY};font-size:12px;color:${INK_MUTED};">Paid in full via PayMongo.</div>
	</td></tr>

	<!-- CTA -->
	<tr><td align="center" style="padding:32px 4px;">
		<!--[if mso]>
		<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(data.manageUrl)}" style="height:46px;v-text-anchor:middle;width:220px;" arcsize="9%" fillcolor="${accent}" strokecolor="${accent}">
		<w:anchorlock/><center style="color:${paper};font-family:sans-serif;font-size:15px;font-weight:bold;">View your booking</center>
		</v:roundrect>
		<![endif]-->
		<!--[if !mso]><!-- -->
		<a href="${esc(data.manageUrl)}" style="display:inline-block;background:${accent};color:${paper};font-family:${FONT_BODY};font-size:15px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:4px;">View your booking</a>
		<!--<![endif]-->
		<div style="margin-top:14px;font-family:${FONT_BODY};font-size:13px;">
			<a href="${esc(data.manageBookingUrl)}" style="color:${accentDeep};text-decoration:underline;">Need to make a change or ask us something? Manage your booking →</a>
		</div>
	</td></tr>

	<!-- before you arrive -->
	<tr><td style="padding:24px 4px 28px;border-top:1px solid ${RULE};">
		<div style="font-family:${FONT_DISPLAY};font-size:15px;font-weight:600;color:${INK};">Before you arrive</div>
		<div style="margin-top:10px;font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${INK};">
			Check-in from ${esc(fmtTime(hotel.checkInTime))}, check-out by ${esc(fmtTime(hotel.checkOutTime))}.<br />
			${addressBits ? `${esc(addressBits)}<br />` : ''}
			Bring a valid ID and your confirmation code <span style="font-family:${FONT_DATA};font-weight:700;color:${INK};">${esc(data.confirmationCode)}</span>.
		</div>
	</td></tr>

	<!-- footer -->
	<tr><td style="padding:16px 4px 0;border-top:1px solid ${RULE};">
		<div style="font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${INK_MUTED};">
			${esc([hotel.name, hotel.city].filter(Boolean).join(' · '))}<br />
			Booked directly with ${esc(hotel.name)}. The price you saw is the price you paid.
			${contactBits ? `<br />${esc(contactBits)}` : ''}
		</div>
	</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

	// ---- plain-text alternative ----
	const rule = '─'.repeat(48);
	const tLines: string[] = [];
	tLines.push(hotel.name.toUpperCase());
	tLines.push(rule);
	tLines.push('');
	tLines.push('RESERVATION CONFIRMED');
	tLines.push(`Confirmation code:  ${data.confirmationCode}`);
	tLines.push(`${data.guestName}, your stay is booked and paid in full.`);
	tLines.push('');
	tLines.push(rule);
	if (nights > 0 && firstRoom) {
		tLines.push(`Check-in    ${fmtDate(firstRoom.checkIn)}  (from ${fmtTime(hotel.checkInTime)})`);
		tLines.push(`Check-out   ${fmtDate(firstRoom.checkOut)}  (by ${fmtTime(hotel.checkOutTime)})`);
		tLines.push(`Nights      ${nights}`);
	}
	for (const r of data.roomLines) {
		const qty = r.quantity > 1 ? ` x${r.quantity}` : '';
		tLines.push(`Room        ${r.roomTypeName} - ${r.ratePlanName}${qty}`);
		if (data.roomLines.length > 1) tLines.push(`            ${fmtDate(r.checkIn)} - ${fmtDate(r.checkOut)}`);
	}
	for (const h of data.hallLines) {
		tLines.push(`Hall        ${h.hallName}`);
		tLines.push(`            ${h.eventType} - ${fmtDate(h.eventDate)} ${fmtTime(h.startTime)}-${fmtTime(h.endTime)}`);
	}
	tLines.push(rule);
	tLines.push(`Subtotal    ${money(data.subtotalCentavos, currency)}`);
	if (data.feesCentavos > 0) tLines.push(`Fees        ${money(data.feesCentavos, currency)}`);
	tLines.push(`VAT         ${money(data.vatCentavos, currency)}`);
	tLines.push(`TOTAL PAID  ${money(data.totalCentavos, currency)}   (via PayMongo)`);
	tLines.push(rule);
	tLines.push('');
	tLines.push('View your booking:');
	tLines.push(data.manageUrl);
	tLines.push('');
	tLines.push('Need to make a change or ask us something? Manage your booking:');
	tLines.push(data.manageBookingUrl);
	tLines.push('');
	tLines.push(`Before you arrive: check-in from ${fmtTime(hotel.checkInTime)}, check-out by ${fmtTime(hotel.checkOutTime)}.`);
	if (addressBits) tLines.push(addressBits);
	tLines.push(`Bring a valid ID and your confirmation code ${data.confirmationCode}.`);
	tLines.push('');
	tLines.push(`${[hotel.name, hotel.city].filter(Boolean).join(' - ')}`);
	tLines.push('Booked directly with ' + hotel.name + '. The price you saw is the price you paid.');
	if (contactBits) tLines.push(contactBits.replace(/·/g, '-'));

	return { subject, html, text: tLines.join('\n') };
}
