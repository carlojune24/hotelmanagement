import { and, eq } from 'drizzle-orm';
import { db } from '../db/index';
import { emailLog, type EmailType } from '../db/schema/index';
import { fromForHotel, getTransport, isEmailConfigured } from './transport';

export interface SendMailInput {
	hotelId: string;
	/** Display name on the `From` line — the hotel, not the platform. */
	hotelName: string;
	orderId?: string | null;
	type: EmailType;
	to: string;
	subject: string;
	html: string;
	text: string;
}

export interface SendMailResult {
	ok: boolean;
	messageId?: string;
	error?: string;
}

/**
 * Sends one transactional email and records the attempt in `email_log` (one row,
 * `sent` or `failed`). Never throws — callers treat email as best-effort. When
 * SMTP is unconfigured the message is printed to the server console instead of
 * being delivered.
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
	try {
		const info = await getTransport().sendMail({
			from: fromForHotel(input.hotelName),
			to: input.to,
			subject: input.subject,
			html: input.html,
			text: input.text
		});

		if (!isEmailConfigured()) {
			console.log(
				`\n[email] SMTP not configured — not delivered.\n` +
					`  to:      ${input.to}\n` +
					`  subject: ${input.subject}\n` +
					`${input.text.replace(/^/gm, '  | ')}\n`
			);
		}

		const messageId = typeof info?.messageId === 'string' ? info.messageId : undefined;
		await db.insert(emailLog).values({
			hotelId: input.hotelId,
			orderId: input.orderId ?? null,
			type: input.type,
			toAddress: input.to,
			subject: input.subject,
			status: 'sent',
			messageId: messageId ?? null
		});
		return { ok: true, messageId };
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		console.error('[email] send failed', input.type, input.to, error);
		await db
			.insert(emailLog)
			.values({
				hotelId: input.hotelId,
				orderId: input.orderId ?? null,
				type: input.type,
				toAddress: input.to,
				subject: input.subject,
				status: 'failed',
				error
			})
			.catch((logErr) => console.error('[email] could not write email_log', logErr));
		return { ok: false, error };
	}
}

/** True if a `sent` mail of this type is already logged for the order — the
 *  guard against re-sending on a redelivered webhook or a manual retry. */
export async function alreadySent(orderId: string, type: EmailType): Promise<boolean> {
	const [row] = await db
		.select({ id: emailLog.id })
		.from(emailLog)
		.where(and(eq(emailLog.orderId, orderId), eq(emailLog.type, type), eq(emailLog.status, 'sent')))
		.limit(1);
	return Boolean(row);
}
