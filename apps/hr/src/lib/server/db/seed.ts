import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { hash } from '@node-rs/argon2';
import { ulid } from 'ulid';
import * as schema from './schema/index';

/**
 * One-time bootstrap: the organization row and the first Main HR account. Idempotent — re-running
 * never overwrites an existing user's password. Reads SEED_* from `.env` (see `.env.example`).
 * Standalone script (no `$env`), so it hashes with the same argon2 settings as `auth/password.ts`.
 */
const url = process.env.DATABASE_URL;
const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;
const orgName = process.env.SEED_ORG_NAME?.trim();
if (!url) throw new Error('DATABASE_URL is not set');
if (!email || !password || !orgName) {
	throw new Error('Set SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD and SEED_ORG_NAME in .env first.');
}
if (password.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters.');

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: 'snake_case' });

let org = await db.select().from(schema.organizations).limit(1).then((r) => r.at(0));
if (!org) {
	[org] = await db
		.insert(schema.organizations)
		.values({ orgRef: `org_${ulid()}`, name: orgName })
		.returning();
	console.log(`created organization "${orgName}"`);
}

let user = await db.select().from(schema.users).where(eq(schema.users.email, email)).then((r) => r.at(0));
if (!user) {
	const pepper = process.env.AUTH_PEPPER ?? '';
	const passwordHash = await hash(`${password}${pepper}`, {
		memoryCost: 19456,
		timeCost: 2,
		outputLen: 32,
		parallelism: 1
	});
	[user] = await db
		.insert(schema.users)
		.values({
			email,
			passwordHash,
			name: process.env.SEED_ADMIN_NAME?.trim() || 'Main HR'
		})
		.returning();
	console.log(`created user ${email}`);
}

await db
	.insert(schema.orgMemberships)
	.values({ userId: user!.id, organizationId: org!.id, role: 'main_hr' })
	.onConflictDoNothing();

await client.end();
console.log('seed complete');
