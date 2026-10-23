import nodemailer, { type Transporter } from 'nodemailer';
import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { emailSettings } from '../db/schema/index';
import { decryptSecret } from '../secrets';

/** The company's own outgoing mailbox (Settings → Sign-in & email). There is no platform fallback: no
 *  mailbox set up means nothing is sent, and the emailed sign-in code cannot be switched on. */
export interface Mailer {
	transport: Transporter;
	from: { name: string; address: string };
	replyTo?: string;
}

/** SMTP transport options — shared with "Send test email". */
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
		auth: s.username ? { user: s.username, pass: s.password ?? '' } : undefined,
		// A wrong host or a firewall should fail a sign-in quickly, not hang it.
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 15_000
	};
}

export async function getMailer(organizationId: string, orgName: string): Promise<Mailer | null> {
	const [row] = await db.select().from(emailSettings).where(eq(emailSettings.organizationId, organizationId)).limit(1);
	if (!row) return null;
	const transport = nodemailer.createTransport(
		smtpOptions({ ...row, password: row.passwordEnc ? decryptSecret(row.passwordEnc) : null })
	);
	return {
		transport,
		from: { name: row.fromName || orgName, address: row.fromAddress },
		replyTo: row.replyTo ?? undefined
	};
}
