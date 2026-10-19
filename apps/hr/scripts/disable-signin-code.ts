/**
 * Break-glass: switch the emailed sign-in code off, for when the mailbox is down and nobody can get in.
 *   pnpm exec tsx --env-file=.env scripts/disable-signin-code.ts
 * Run from apps/hr on the server. Main HR can switch it back on in Settings → Sign-in & email.
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (run with --env-file=.env).');

const sql = postgres(url, { max: 1 });
const rows = await sql`update email_settings set signin_code_required = false where signin_code_required = true returning id`;
await sql`delete from login_challenges`;
console.log(rows.length ? 'Sign-in code switched off. Everyone can sign in with a password again.' : 'The sign-in code was already off.');
await sql.end();
