import nodemailer, { type Transporter } from 'nodemailer';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '../db/index';
import { emailSettings } from '../db/schema/index';
import { decryptSecret } from '../secrets';

/**
 * Transactional email transport, per hotel. A hotel that set up its own mailbox under
 * Settings → Payments & email (`email_settings`) sends through that SMTP server, from its own
 * address. Every other hotel falls back to the platform SMTP from `SMTP_*` env vars, sent as
 * the hotel's name. With neither, a no-network JSON transport prints the mail to the server
 * console, so local dev works with zero setup.
 */

export interface HotelMailer {
	transport: Transporter;
	from: { name: string; address: string };
	replyTo?: string;
	/** False only for the console fallback (nothing is actually delivered). */
	delivers: boolean;
	/** Which mailbox this is — for the settings page and logs. */
	source: 'hotel' | 'platform' | 'console';
}

let platformTransport: Transporter | null = null;
const hotelTransports = new Map<
	string,
	{ transport: Transporter; row: typeof emailSettings.$inferSelect }
>();

export function isPlatformEmailConfigured(): boolean {
	return Boolean(env.SMTP_HOST);
}

function getPlatformTransport(): Transporter {
	if (platformTransport) return platformTransport;
	if (isPlatformEmailConfigured()) {
		const port = Number(env.SMTP_PORT) || 587;
		platformTransport = nodemailer.createTransport({
			host: env.SMTP_HOST,
			port,
			secure: port === 465,
			auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
		});
	} else {
		platformTransport = nodemailer.createTransport({ jsonTransport: true });
	}
	return platformTransport;
}

/** `no-reply@…` address the platform sends from, parsed out of `SMTP_FROM`. */
export function platformFromAddress(): string {
	const raw = env.SMTP_FROM?.trim();
	if (!raw) return 'no-reply@localhost';
	const angle = raw.match(/<([^>]+)>/);
	return (angle?.[1] ?? raw).trim();
}

/** SMTP transport options for a stored row — shared with "Send test email" before saving. */
export function smtpOptions(s: {
	host: string;
	port: number;
	secure: boolean;
	username: string | null;
	password: string | null;
}) {
	return {
		host: s.host,
		port: s.port,
		secure: s.secure,
		auth: s.username ? { user: s.username, pass: s.password ?? '' } : undefined
	};
}

/** The mailer a hotel's guest/staff email goes out through. */
export async function getMailerForHotel(hotelId: string, hotelName: string): Promise<HotelMailer> {
	let entry = hotelTransports.get(hotelId);
	if (!entry) {
		const [row] = await db
			.select()
			.from(emailSettings)
			.where(eq(emailSettings.hotelId, hotelId))
			.limit(1);
		if (row) {
			const transport = nodemailer.createTransport(
				smtpOptions({
					...row,
					password: row.passwordEnc ? decryptSecret(row.passwordEnc) : null
				})
			);
			entry = { transport, row };
			hotelTransports.set(hotelId, entry);
		}
	}

	if (entry) {
		return {
			transport: entry.transport,
			from: { name: entry.row.fromName || hotelName, address: entry.row.fromAddress },
			replyTo: entry.row.replyTo ?? undefined,
			delivers: true,
			source: 'hotel'
		};
	}
	return {
		transport: getPlatformTransport(),
		// The hotel's own name as the display name over the platform's sending address, so a
		// guest sees the hotel, not "MM Hotel".
		from: { name: hotelName, address: platformFromAddress() },
		delivers: isPlatformEmailConfigured(),
		source: isPlatformEmailConfigured() ? 'platform' : 'console'
	};
}

/** Call after a hotel's email settings change so the next send re-reads them. */
export function forgetHotelMailer(hotelId: string): void {
	const entry = hotelTransports.get(hotelId);
	entry?.transport.close();
	hotelTransports.delete(hotelId);
}
