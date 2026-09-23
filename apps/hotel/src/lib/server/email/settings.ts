import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { emailSettings, hotels } from '../db/schema/index';
import { DEFAULT_ACCENT_COLOR, DEFAULT_PAPER_COLOR, parseBranding } from '../branding';
import { renderTestEmail } from './test-email';
import { encryptSecret, maskSecret } from '../secrets';
import { writeAudit } from '../audit';
import { forgetHotelMailer, getMailerForHotel, isPlatformEmailConfigured } from './transport';
import type { SessionUser } from '../auth/session';

/** A hotel's own outgoing mailbox (Settings → Payments & email). Hotel-admin only. */

export class EmailSettingsError extends Error {}

export interface EmailSettingsInput {
	host: string;
	port: number;
	secure: boolean;
	username: string | null;
	/** Blank = keep the stored password (the page never receives it back). */
	password: string | null;
	fromName: string | null;
	fromAddress: string;
	replyTo: string | null;
}

/** What the settings page may show — never the password itself. */
export async function getEmailSettingsView(hotelId: string) {
	const [row] = await db
		.select()
		.from(emailSettings)
		.where(eq(emailSettings.hotelId, hotelId))
		.limit(1);
	return {
		settings: row
			? {
					host: row.host,
					port: row.port,
					secure: row.secure,
					username: row.username,
					passwordHint: row.passwordHint,
					fromName: row.fromName,
					fromAddress: row.fromAddress,
					replyTo: row.replyTo,
					lastTestAt: row.lastTestAt?.toISOString() ?? null,
					lastTestOk: row.lastTestOk,
					lastTestError: row.lastTestError
				}
			: null,
		/** Whether hotels without their own mailbox have a platform SMTP to fall back on. */
		platformConfigured: isPlatformEmailConfigured()
	};
}

export async function saveEmailSettings(
	hotelId: string,
	input: EmailSettingsInput,
	actor: SessionUser | null
): Promise<void> {
	const [existing] = await db
		.select({ passwordEnc: emailSettings.passwordEnc, passwordHint: emailSettings.passwordHint })
		.from(emailSettings)
		.where(eq(emailSettings.hotelId, hotelId))
		.limit(1);

	const newPassword = input.password?.trim() ? input.password : null;
	// No username = no auth, so no password either.
	const passwordEnc = !input.username
		? null
		: newPassword
			? encryptSecret(newPassword)
			: (existing?.passwordEnc ?? null);
	const passwordHint = !input.username
		? null
		: newPassword
			? maskSecret(newPassword)
			: (existing?.passwordHint ?? null);
	if (input.username && !passwordEnc) {
		throw new EmailSettingsError('Enter the mailbox password.');
	}

	const values = {
		host: input.host.trim(),
		port: input.port,
		secure: input.secure,
		username: input.username?.trim() || null,
		passwordEnc,
		passwordHint,
		fromName: input.fromName?.trim() || null,
		fromAddress: input.fromAddress.trim(),
		replyTo: input.replyTo?.trim() || null,
		// A changed mailbox hasn't been tested yet.
		lastTestAt: null,
		lastTestOk: null,
		lastTestError: null,
		updatedByUserId: actor?.id ?? null,
		updatedAt: new Date()
	};
	await db
		.insert(emailSettings)
		.values({ hotelId, ...values })
		.onConflictDoUpdate({ target: emailSettings.hotelId, set: values });
	forgetHotelMailer(hotelId);

	await writeAudit({
		hotelId,
		actor,
		action: existing ? 'integration.email_updated' : 'integration.email_connected',
		entityType: 'hotel',
		entityId: hotelId,
		// Never the password — only whether it changed.
		after: {
			host: values.host,
			port: values.port,
			secure: values.secure,
			username: values.username,
			fromAddress: values.fromAddress,
			replyTo: values.replyTo,
			passwordChanged: !!newPassword
		}
	});
}

export async function clearEmailSettings(
	hotelId: string,
	actor: SessionUser | null
): Promise<void> {
	await db.delete(emailSettings).where(eq(emailSettings.hotelId, hotelId));
	forgetHotelMailer(hotelId);
	await writeAudit({
		hotelId,
		actor,
		action: 'integration.email_removed',
		entityType: 'hotel',
		entityId: hotelId
	});
}

/** Sends a short test message through the hotel's saved mailbox and records the outcome. */
export async function sendTestEmail(
	hotelId: string,
	hotelName: string,
	to: string
): Promise<{ ok: boolean; error?: string }> {
	const mailer = await getMailerForHotel(hotelId, hotelName);
	const [hotel] = await db.select().from(hotels).where(eq(hotels.id, hotelId)).limit(1);
	const branding = parseBranding(hotel?.config);
	const [settingsRow] =
		mailer.source === 'hotel'
			? await db
					.select({ host: emailSettings.host })
					.from(emailSettings)
					.where(eq(emailSettings.hotelId, hotelId))
					.limit(1)
			: [];
	// Same look as every other guest email, so the admin previews what guests will get.
	const { subject, html, text } = renderTestEmail({
		hotel: {
			name: hotelName,
			city: hotel?.city ?? null,
			logoUrl: null,
			accentColor: branding.accentColor ?? DEFAULT_ACCENT_COLOR,
			paperColor: branding.paperColor ?? DEFAULT_PAPER_COLOR
		},
		fromAddress: mailer.from.address,
		mailboxLabel: settingsRow ? `Your mailbox (${settingsRow.host})` : 'Platform mailbox',
		sentAtLabel: new Date().toLocaleString('en-PH', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: hotel?.timezone ?? 'Asia/Manila'
		})
	});
	let result: { ok: boolean; error?: string };
	try {
		await mailer.transport.sendMail({
			from: mailer.from,
			replyTo: mailer.replyTo,
			to,
			subject,
			html,
			text
		});
		result = { ok: true };
	} catch (e) {
		result = { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
	if (mailer.source === 'hotel') {
		await db
			.update(emailSettings)
			.set({ lastTestAt: new Date(), lastTestOk: result.ok, lastTestError: result.error ?? null })
			.where(eq(emailSettings.hotelId, hotelId));
	}
	return result;
}
