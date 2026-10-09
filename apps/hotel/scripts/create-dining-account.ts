/**
 * Creates the dining-only staff account: it signs in at /{hotel}/management/login and sees only the
 * Dining section (Floor, Orders, Reservations), never the manager's pages.
 *
 *   pnpm --filter @mm/hotel exec tsx scripts/create-dining-account.ts
 *
 * Defaults: dining@example.com / dining12345 at the hotel "hotel1". Override with
 * DINING_EMAIL, DINING_PASSWORD, DINING_NAME, DINING_HOTEL_SLUG. Safe to re-run: nothing changes
 * once the account is right, and it will not reset a password somebody changed (pass
 * --reset-password) or take over a manager / platform admin / disabled account (pass --force).
 *
 * Pass --sync-capabilities to add any permission the role has gained since this hotel's copy was made.
 *
 * Unlike `db:seed`, this touches only this one account: it does not reset the admin or manager.
 */
import 'dotenv/config';
import { hash, verify } from '@node-rs/argon2';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema/index';
import { ensureDiningAccount } from '../src/lib/server/auth/staff-account';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// Must match src/lib/server/auth/password.ts exactly, pepper included, or the login will never accept it.
const argon = { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 } as const;
const pepper = process.env.AUTH_PEPPER ?? '';

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: 'snake_case' });

const hotelSlug = process.env.DINING_HOTEL_SLUG ?? 'hotel1';
const password = process.env.DINING_PASSWORD ?? 'dining12345';

async function main() {
	const r = await ensureDiningAccount(db as never, {
		hotelSlug,
		email: process.env.DINING_EMAIL ?? 'dining@example.com',
		name: process.env.DINING_NAME ?? 'Dining',
		password,
		hashPassword: (pw) => hash(pw + pepper, argon),
		verifyPassword: (digest, pw) => verify(digest, pw + pepper, argon),
		force: process.argv.includes('--force'),
		resetPassword: process.argv.includes('--reset-password'),
		syncCapabilities: process.argv.includes('--sync-capabilities')
	});

	console.log(r.createdUser ? `Created ${r.email}.` : `${r.email} already existed.`);
	console.log(r.membershipChanged ? `Gave it the Dining role at "${hotelSlug}".` : `It already has the Dining role at "${hotelSlug}".`);
	if (r.capabilitiesAdded.length > 0) console.log(`Added to the role: ${r.capabilitiesAdded.join(', ')}.`);
	console.log(r.passwordSet ? 'Password set (and checked).' : 'Password left as it was (use --reset-password to set it again).');
	console.log(`Sign in at /${hotelSlug}/management/login. Change the default password after the first sign-in.`);
}

main()
	.catch((e) => {
		console.error(e instanceof Error ? e.message : e);
		process.exitCode = 1;
	})
	.finally(() => client.end());
