import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ulid } from 'ulid';
import * as schema from './schema/index';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: 'snake_case' });

const argon = { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 } as const;
const pepper = process.env.AUTH_PEPPER ?? '';
const hashPw = (pw: string) => hash(pw + pepper, argon);

const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';
const MANAGER_EMAIL = (process.env.SEED_MANAGER_EMAIL ?? 'manager@example.com').toLowerCase();
const MANAGER_PW = process.env.SEED_MANAGER_PASSWORD ?? 'manager12345';
const HOTEL_SLUG = process.env.SEED_HOTEL_SLUG ?? 'hotel1';

async function upsertUser(input: {
	email: string;
	name: string;
	password: string;
	isPlatformAdmin: boolean;
}) {
	const existing = await db
		.select()
		.from(schema.users)
		.where(eq(schema.users.email, input.email))
		.then((r) => r.at(0));
	const passwordHash = await hashPw(input.password);
	if (existing) {
		await db
			.update(schema.users)
			.set({ name: input.name, passwordHash, isPlatformAdmin: input.isPlatformAdmin })
			.where(eq(schema.users.id, existing.id));
		return existing.id;
	}
	const [row] = await db
		.insert(schema.users)
		.values({ email: input.email, name: input.name, passwordHash, isPlatformAdmin: input.isPlatformAdmin })
		.returning({ id: schema.users.id });
	return row!.id;
}

async function main() {
	const adminId = await upsertUser({
		email: ADMIN_EMAIL,
		name: 'Platform Admin',
		password: ADMIN_PW,
		isPlatformAdmin: true
	});

	const managerId = await upsertUser({
		email: MANAGER_EMAIL,
		name: 'Hotel Manager',
		password: MANAGER_PW,
		isPlatformAdmin: false
	});

	let hotel = await db
		.select()
		.from(schema.hotels)
		.where(eq(schema.hotels.slug, HOTEL_SLUG))
		.then((r) => r.at(0));

	if (!hotel) {
		const [row] = await db
			.insert(schema.hotels)
			.values({
				slug: HOTEL_SLUG,
				name: 'Demo Hotel',
				legalName: 'Demo Hotel Corp.',
				orgRef: `org_${ulid()}`,
				city: 'Manila',
				timezone: 'Asia/Manila',
				status: 'published'
			})
			.returning();
		hotel = row!;
	}

	await db
		.insert(schema.memberships)
		.values({ userId: managerId, hotelId: hotel.id, role: 'hotel_admin' })
		.onConflictDoUpdate({
			target: [schema.memberships.userId, schema.memberships.hotelId],
			set: { role: 'hotel_admin' }
		});

	console.log('Seed complete:');
	console.log(`  Platform admin : ${ADMIN_EMAIL} / ${ADMIN_PW}  -> /admin`);
	console.log(`  Hotel manager  : ${MANAGER_EMAIL} / ${MANAGER_PW}  -> /${HOTEL_SLUG}/dashboard`);
	console.log(`  Demo hotel     : /${HOTEL_SLUG}  (${hotel.orgRef})`);
	void adminId;
}

main()
	.then(() => client.end())
	.catch(async (e) => {
		console.error(e);
		await client.end();
		process.exit(1);
	});
