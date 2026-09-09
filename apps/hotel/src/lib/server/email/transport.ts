import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '$env/dynamic/private';

/**
 * Transactional email transport. Configured entirely from `SMTP_*` env vars so
 * the app is provider-agnostic (SES, Mailgun, Gmail, Resend's SMTP bridge, a
 * local catcher — all just host/port/credentials). When `SMTP_HOST` is unset the
 * transport falls back to a no-network JSON transport and `sendMail` prints the
 * message to the server console, so local dev works with zero setup.
 */
let cached: Transporter | null = null;

export function isEmailConfigured(): boolean {
	return Boolean(env.SMTP_HOST);
}

export function getTransport(): Transporter {
	if (cached) return cached;

	if (isEmailConfigured()) {
		const port = Number(env.SMTP_PORT) || 587;
		cached = nodemailer.createTransport({
			host: env.SMTP_HOST,
			port,
			secure: port === 465,
			auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
		});
	} else {
		cached = nodemailer.createTransport({ jsonTransport: true });
	}
	return cached;
}

/** `no-reply@…` address the app sends from, parsed out of `SMTP_FROM`. */
export function fromAddress(): string {
	const raw = env.SMTP_FROM?.trim();
	if (!raw) return 'no-reply@localhost';
	const angle = raw.match(/<([^>]+)>/);
	return (angle?.[1] ?? raw).trim();
}

/**
 * `From` for a hotel's guest mail: the hotel's own name as the display name over
 * the platform's sending address (so a guest sees the hotel, not "MM Hotel").
 */
export function fromForHotel(hotelName: string): { name: string; address: string } {
	return { name: hotelName, address: fromAddress() };
}
