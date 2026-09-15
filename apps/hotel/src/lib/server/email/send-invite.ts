import { renderStaffInvite } from './invite';
import { sendMail, type SendMailResult } from './send';

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
