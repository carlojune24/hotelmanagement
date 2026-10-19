/**
 * Save the company mailbox from the command line (same result as Settings → Sign-in & email → Save mailbox),
 * for setting a server up without typing the password into a browser. The values come as JSON on stdin, so the
 * password never appears in a command line or shell history:
 *
 *   echo '{"host":"smtp.gmail.com","port":587,"secure":false,"username":"a@b.c","password":"…","fromAddress":"a@b.c"}' \
 *     | pnpm exec tsx --env-file=.env scripts/set-mailbox.ts
 *
 * Needs DATABASE_URL and APP_ENCRYPTION_KEY in .env. It does not send anything: open Settings → Sign-in & email,
 * press "Send a test email", and only then can the sign-in code be switched on.
 * (The encryption is the same AES-256-GCM scheme as src/lib/server/secrets.ts, kept inline because that file
 * needs SvelteKit's $env and cannot run under plain tsx.)
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (run with --env-file=.env).');
const key = Buffer.from(process.env.APP_ENCRYPTION_KEY ?? '', 'base64');
if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (base64) in .env.');

const encrypt = (plain: string) => {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
};
const decrypt = (stored: string) => {
	const [, iv, tag, ct] = stored.split(':');
	const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv!, 'base64'));
	d.setAuthTag(Buffer.from(tag!, 'base64'));
	return Buffer.concat([d.update(Buffer.from(ct!, 'base64')), d.final()]).toString('utf8');
};
const mask = (s: string) => (s.trim().length <= 8 ? '••••' : `…${s.trim().slice(-4)}`);

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw) as {
	host: string;
	port: number;
	secure?: boolean;
	username?: string | null;
	password?: string | null;
	fromName?: string | null;
	fromAddress: string;
	replyTo?: string | null;
};
if (!input.host || !input.port || !input.fromAddress) throw new Error('host, port and fromAddress are required.');
if (input.username && !input.password) throw new Error('A username needs a password.');

const passwordEnc = input.username && input.password ? encrypt(input.password) : null;
if (passwordEnc && decrypt(passwordEnc) !== input.password) throw new Error('Encryption self-check failed.');

const sql = postgres(url, { max: 1 });
const [org] = await sql`select id from organizations limit 1`;
if (!org) throw new Error('There is no organization in this database.');
const values = {
	host: input.host.trim(),
	port: input.port,
	secure: input.secure === true,
	username: input.username?.trim() || null,
	password_enc: passwordEnc,
	password_hint: passwordEnc && input.password ? mask(input.password) : null,
	from_name: input.fromName?.trim() || null,
	from_address: input.fromAddress.trim(),
	reply_to: input.replyTo?.trim() || null
};
// A new mailbox is untested and the code requirement starts off, exactly as when it is saved in Settings.
await sql`
	insert into email_settings (organization_id, host, port, secure, username, password_enc, password_hint, from_name, from_address, reply_to, signin_code_required)
	values (${org.id}, ${values.host}, ${values.port}, ${values.secure}, ${values.username}, ${values.password_enc}, ${values.password_hint}, ${values.from_name}, ${values.from_address}, ${values.reply_to}, false)
	on conflict (organization_id) do update set
		host = excluded.host, port = excluded.port, secure = excluded.secure, username = excluded.username,
		password_enc = excluded.password_enc, password_hint = excluded.password_hint, from_name = excluded.from_name,
		from_address = excluded.from_address, reply_to = excluded.reply_to, signin_code_required = false,
		last_test_at = null, last_test_ok = null, last_test_error = null, updated_at = now()`;
console.log(`Mailbox saved: ${values.host}:${values.port} from ${values.from_address}${values.password_hint ? `, password ${values.password_hint}` : ''}.`);
console.log('Next: Settings → Sign-in & email → "Send a test email".');
await sql.end();
