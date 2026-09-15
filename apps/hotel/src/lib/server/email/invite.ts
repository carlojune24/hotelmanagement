/**
 * Staff-invite email — a plain operational transactional message, not the guest-facing
 * Woven Ledger idiom (see booking-confirmation.ts/apps/hotel/DESIGN.md): this goes to a
 * staff member being invited to operate the hotel, not a guest, so it carries no
 * per-hotel storefront branding.
 */

export interface StaffInviteEmailData {
	hotelName: string;
	roleName: string;
	inviteUrl: string;
	inviterName: string | null;
	expiresInDays: number;
}

export interface RenderedEmail {
	subject: string;
	html: string;
	text: string;
}

const FONT_BODY =
	"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = '#1f2430';
const INK_MUTED = '#5b6472';
const RULE = '#e2e5ea';
const ACCENT = '#2563eb';

const esc = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderStaffInvite(data: StaffInviteEmailData): RenderedEmail {
	const invitedBy = data.inviterName ? ` by ${data.inviterName}` : '';
	const subject = `You've been invited to join ${data.hotelName} on MM Hotel`;

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:${FONT_BODY};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f7;">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;background:#ffffff;border:1px solid ${RULE};border-radius:8px;">

	<tr><td style="padding:28px 28px 0;">
		<div style="font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${INK_MUTED};">MM Hotel</div>
	</td></tr>

	<tr><td style="padding:16px 28px 0;">
		<div style="font-size:20px;font-weight:600;color:${INK};">You're invited to ${esc(data.hotelName)}</div>
		<div style="margin-top:10px;font-size:14px;line-height:1.6;color:${INK_MUTED};">
			You've been invited${esc(invitedBy)} to join <strong style="color:${INK};">${esc(data.hotelName)}</strong>
			as <strong style="color:${INK};">${esc(data.roleName)}</strong>.
		</div>
	</td></tr>

	<tr><td style="padding:24px 28px 0;">
		<table role="presentation" cellpadding="0" cellspacing="0" border="0">
			<tr><td style="background:${ACCENT};border-radius:6px;">
				<a href="${esc(data.inviteUrl)}" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Set up your account</a>
			</td></tr>
		</table>
	</td></tr>

	<tr><td style="padding:20px 28px 0;">
		<div style="font-size:12px;line-height:1.6;color:${INK_MUTED};">
			Or copy this link:<br />
			<span style="word-break:break-all;">${esc(data.inviteUrl)}</span>
		</div>
	</td></tr>

	<tr><td style="padding:20px 28px 28px;border-top:1px solid ${RULE};margin-top:20px;">
		<div style="padding-top:16px;font-size:12px;color:${INK_MUTED};">
			This link expires in ${data.expiresInDays} day${data.expiresInDays === 1 ? '' : 's'}. If you weren't
			expecting this invite, you can ignore this email.
		</div>
	</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

	const text = [
		`You're invited to ${data.hotelName}`,
		'',
		`You've been invited${invitedBy} to join ${data.hotelName} as ${data.roleName}.`,
		'',
		`Set up your account: ${data.inviteUrl}`,
		'',
		`This link expires in ${data.expiresInDays} day${data.expiresInDays === 1 ? '' : 's'}. If you weren't expecting this invite, you can ignore this email.`
	].join('\n');

	return { subject, html, text };
}
