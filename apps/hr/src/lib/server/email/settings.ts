import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { emailSettings } from '../db/schema/index';
import { writeAudit } from '../audit';
import { encryptSecret, maskSecret } from '../secrets';
import { getMailer } from './mailer';
import type { SessionUser } from '../auth/session';

/** The company's outgoing mailbox, and whether the emailed sign-in code is on. Main HR only. */

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
export async function getEmailSettingsView(organizationId: string) {
	const [row] = await db.select().from(emailSettings).where(eq(emailSettings.organizationId, organizationId)).limit(1);
	return row
		? {
				host: row.host,
				port: row.port,
				secure: row.secure,
				username: row.username,
				passwordHint: row.passwordHint,
				fromName: row.fromName,
				fromAddress: row.fromAddress,
				replyTo: row.replyTo,
				signinCodeRequired: row.signinCodeRequired,
				lastTestAt: row.lastTestAt?.toISOString() ?? null,
				lastTestOk: row.lastTestOk,
				lastTestError: row.lastTestError
			}
		: null;
}

export async function saveEmailSettings(organizationId: string, input: EmailSettingsInput, actor: SessionUser | null) {
	const [existing] = await db
		.select()
		.from(emailSettings)
		.where(eq(emailSettings.organizationId, organizationId))
		.limit(1);

	const newPassword = input.password?.trim() ? input.password : null;
	// No username = no authentication, so no password either.
	const passwordEnc = !input.username ? null : newPassword ? encryptSecret(newPassword) : (existing?.passwordEnc ?? null);
	const passwordHint = !input.username ? null : newPassword ? maskSecret(newPassword) : (existing?.passwordHint ?? null);
	if (input.username && !passwordEnc) throw new EmailSettingsError('Enter the mailbox password.');

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
		// A changed mailbox has not been tested, so the code requirement must be switched on again afterwards.
		lastTestAt: null,
		lastTestOk: null,
		lastTestError: null,
		signinCodeRequired: false,
		updatedByUserId: actor?.id ?? null,
		updatedAt: new Date()
	};
	await db
		.insert(emailSettings)
		.values({ organizationId, ...values })
		.onConflictDoUpdate({ target: emailSettings.organizationId, set: values });

	await writeAudit({
		actor,
		action: existing ? 'email.updated' : 'email.connected',
		entityType: 'organization',
		entityId: organizationId,
		// Never the password — only whether it changed.
		after: {
			host: values.host,
			port: values.port,
			secure: values.secure,
			username: values.username,
			fromAddress: values.fromAddress,
			passwordChanged: !!newPassword,
			signinCodeSwitchedOff: existing?.signinCodeRequired === true
		}
	});
}

/** Sends a short test message through the saved mailbox and records the outcome. */
export async function sendTestEmail(organizationId: string, orgName: string, to: string): Promise<{ ok: boolean; error?: string }> {
	const mailer = await getMailer(organizationId, orgName);
	if (!mailer) return { ok: false, error: 'Save the mailbox first.' };
	let result: { ok: boolean; error?: string };
	try {
		await mailer.transport.sendMail({
			from: mailer.from,
			replyTo: mailer.replyTo,
			to,
			subject: `${orgName}: test email`,
			text: `This is a test message from ${orgName}.\n\nIf you can read it, the mailbox is set up correctly and sign-in codes can be sent.`
		});
		result = { ok: true };
	} catch (e) {
		result = { ok: false, error: e instanceof Error ? e.message : String(e) };
	} finally {
		mailer.transport.close();
	}
	await db
		.update(emailSettings)
		.set({ lastTestAt: new Date(), lastTestOk: result.ok, lastTestError: result.error ?? null })
		.where(eq(emailSettings.organizationId, organizationId));
	return result;
}

/** Turn the emailed sign-in code on or off. On is refused until a test email has gone through. */
export async function setSigninCodeRequired(organizationId: string, on: boolean, actor: SessionUser | null) {
	const [row] = await db.select().from(emailSettings).where(eq(emailSettings.organizationId, organizationId)).limit(1);
	if (!row) throw new EmailSettingsError('Set up the mailbox first.');
	if (on && row.lastTestOk !== true) {
		throw new EmailSettingsError('Send a test email that arrives before switching the sign-in code on.');
	}
	await db
		.update(emailSettings)
		.set({ signinCodeRequired: on, updatedAt: new Date(), updatedByUserId: actor?.id ?? null })
		.where(eq(emailSettings.organizationId, organizationId));
	await writeAudit({
		actor,
		action: on ? 'signin_code.enabled' : 'signin_code.disabled',
		entityType: 'organization',
		entityId: organizationId
	});
}
