import { darken } from '$lib/woven-pattern';
import type { RenderedEmail } from './booking-confirmation';

/**
 * Settings → Payments & email "Send test email" — the Woven Ledger email idiom (see
 * `booking-confirmation.ts` and apps/hotel/DESIGN.md), so the admin previews what guests will
 * actually receive from this mailbox: same masthead, colours, mono data register and footer.
 * The data rows say which mailbox sent it. Pure; unit-tested.
 */

export interface TestEmailData {
	hotel: {
		name: string;
		city: string | null;
		logoUrl: string | null;
		accentColor: string;
		paperColor: string;
	};
	/** The From address guests will see. */
	fromAddress: string;
	/** "Your mailbox (smtp.gmail.com)" / "Platform mailbox". */
	mailboxLabel: string;
	/** Already formatted in the hotel's timezone. */
	sentAtLabel: string;
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

export function renderTestEmail(data: TestEmailData): RenderedEmail {
	const { hotel } = data;
	const accent = /^#[0-9a-fA-F]{6}$/.test(hotel.accentColor) ? hotel.accentColor : '#836819';
	const paper = /^#[0-9a-fA-F]{6}$/.test(hotel.paperColor) ? hotel.paperColor : '#ffffff';
	const accentDeep = darken(accent, 0.3);
	const band = paper.toLowerCase() === '#ffffff' ? DEFAULT_BAND : darken(paper, 0.03);

	const subject = `Test email from ${hotel.name}`;
	const preheader = `Your email is working — guest emails will come from ${data.fromAddress}.`;

	const logoImg = hotel.logoUrl
		? `<img src="${esc(hotel.logoUrl)}" alt="${esc(hotel.name)}" height="40" style="display:block;height:40px;width:auto;border:0;margin-bottom:10px;" />`
		: '';

	const row = (label: string, value: string) => `<tr>
			<td style="padding:10px 0;border-bottom:1px solid ${RULE};font-family:${FONT_BODY};font-size:13px;color:${INK_MUTED};vertical-align:top;">${esc(label)}</td>
			<td align="right" style="padding:10px 0;border-bottom:1px solid ${RULE};font-family:${FONT_DATA};font-size:13px;color:${INK};vertical-align:top;word-break:break-all;">${esc(value)}</td>
		</tr>`;

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
		<div style="font-family:${FONT_DISPLAY};font-size:26px;font-weight:500;color:${INK};letter-spacing:-0.01em;">Your email is working</div>
		<div style="margin-top:10px;font-family:${FONT_DATA};font-size:13px;font-weight:700;letter-spacing:2px;color:${accentDeep};">TEST EMAIL</div>
		<div style="margin-top:10px;font-family:${FONT_BODY};font-size:14px;line-height:1.55;color:${INK_MUTED};">This is how guest emails from ${esc(hotel.name)} will look — booking confirmations, receipts, cancellations and review requests all go out from this mailbox. Nothing needs to be done.</div>
	</td></tr>

	<tr><td style="padding:24px 4px 0;">
		<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
		${row('Sent from', data.fromAddress)}
		${row('Mailbox', data.mailboxLabel)}
		${row('Sent', data.sentAtLabel)}
		</table>
	</td></tr>

	<tr><td style="padding:24px 4px 0;">
		<div style="font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${INK_MUTED};">Sent from Settings → Payments &amp; email.</div>
	</td></tr>

	<tr><td style="padding:16px 4px 0;margin-top:16px;border-top:1px solid ${RULE};">
		<div style="font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${INK_MUTED};padding-top:16px;">
			${esc([hotel.name, hotel.city].filter(Boolean).join(' · '))}
		</div>
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
		'',
		'YOUR EMAIL IS WORKING — TEST EMAIL',
		`This is how guest emails from ${hotel.name} will look. Nothing needs to be done.`,
		'',
		`Sent from:  ${data.fromAddress}`,
		`Mailbox:    ${data.mailboxLabel}`,
		`Sent:       ${data.sentAtLabel}`,
		'',
		rule,
		[hotel.name, hotel.city].filter(Boolean).join(' - ')
	].join('\n');

	return { subject, html, text };
}
