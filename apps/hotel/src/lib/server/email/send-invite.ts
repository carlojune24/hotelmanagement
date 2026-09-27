import { renderStaffInvite } from './invite';
import { sendMail, sendPlatformMail, type SendMailResult } from './send';

/**
 * Emails a staff invite link. Best-effort and never throws — invite creation
 * already shows the link on-screen (still needed in local dev, where SMTP is
 * usually unconfigured and `sendMail` just logs to the console), so a failed
 * send here doesn't block the inviter from copying the link manually.
 */
export async function sendStaffInvite(input: {
	hotelId: string;
	hotelName: string;
	toEmail: string;
	roleName: string;
	inviteUrl: string;
	inviterName: string | null;
	expiresInDays: number;
}): Promise<SendMailResult> {
	const { subject, html, text } = renderStaffInvite({
		hotelName: input.hotelName,
		roleName: input.roleName,
		inviteUrl: input.inviteUrl,
		inviterName: input.inviterName,
		expiresInDays: input.expiresInDays
	});

	return sendMail({
		hotelId: input.hotelId,
		hotelName: input.hotelName,
		type: 'staff_invite',
		to: input.toEmail,
		subject,
		html,
		text
	});
}

/** Emails a platform-admin invite — not tied to any hotel, so it goes out through
 *  the platform mailer (`sendPlatformMail`), not a hotel's own SMTP settings. */
export async function sendPlatformAdminInvite(input: {
	toEmail: string;
	inviteUrl: string;
	inviterName: string | null;
	expiresInDays: number;
}): Promise<SendMailResult> {
	const { subject, html, text } = renderStaffInvite({
		hotelName: 'MM Hotel',
		roleName: 'Platform Admin',
		inviteUrl: input.inviteUrl,
		inviterName: input.inviterName,
		expiresInDays: input.expiresInDays
	});

	return sendPlatformMail({ to: input.toEmail, subject, html, text });
}
