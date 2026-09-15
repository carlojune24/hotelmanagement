/**
 * One-time backfill for the dynamic-roles migration (drizzle/0035_far_hedge_knight.sql):
 * seeds each hotel's default `roles`/`role_permissions` rows from the legacy `ROLE_CAPS`
 * catalog, then points every `memberships.role_id` at the row matching its old `role` enum
 * value. Idempotent — safe to re-run (skips hotels that already have roles seeded, and only
 * updates memberships still missing a `role_id`).
 *
 *   pnpm --filter @mm/hotel exec tsx scripts/backfill-roles.ts
 *
 * After this runs and `SELECT count(*) FROM memberships WHERE role_id IS NULL` is 0, the
 * follow-up migration can make `role_id` NOT NULL + add the FK, and drop the old `role`
 * column and `membership_role` enum.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { isNull, sql } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema/index';
import { seedDefaultRoles } from '../src/lib/server/auth/roles';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: 'snake_case' });

async function main() {
	const hotels = await db.select().from(schema.hotels);
	for (const hotel of hotels) {
		await seedDefaultRoles(db, hotel.id);
	}
	console.log(`Seeded default roles for ${hotels.length} hotel(s).`);

	for (const hotel of hotels) {
		const result = await db.execute(sql`
			UPDATE ${schema.memberships} m
			SET role_id = r.id
			FROM ${schema.roles} r
			WHERE r.hotel_id = m.hotel_id
			  AND r.slug = m.role::text
			  AND m.hotel_id = ${hotel.id}
			  AND m.role_id IS NULL
		`);
		if (result.count) console.log(`${hotel.slug}: backfilled ${result.count} membership(s).`);
	}

	const remaining = await db
		.select({ userId: schema.memberships.userId, hotelId: schema.memberships.hotelId })
		.from(schema.memberships)
		.where(isNull(schema.memberships.roleId));

	if (remaining.length > 0) {
		console.error(
			`${remaining.length} membership(s) still have no role_id — investigate before proceeding:`,
			remaining
		);
		process.exitCode = 1;
	} else {
		console.log('All memberships resolved to a role_id. Safe to run the follow-up NOT NULL migration.');
	}
}

main()
	.catch((e) => {
		console.error(e);
		process.exitCode = 1;
	})
	.finally(() => client.end());
