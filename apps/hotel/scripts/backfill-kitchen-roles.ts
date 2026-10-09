/**
 * One-time backfill for the Kitchen split (Kitchen moved out of Dining, with its own
 * `kitchen:*` capabilities):
 *   1. seeds the new "Kitchen" role into every hotel that doesn't have it yet, and
 *   2. keeps today's behaviour for roles that already run the board: a role that can see Dining
 *      gets `kitchen:read`, one that could take dining orders gets `kitchen:write`, and one that
 *      could edit the dining menu gets `kitchen:manage` (it used to own the Stations tab).
 * Nobody loses access on deploy. Afterwards a hotel admin can take `kitchen:write` off Front Desk
 * in Settings → Team → Roles if only cooks should start and finish dishes.
 *
 * Idempotent: it only adds what a role is missing, so it is safe to re-run.
 *
 *   pnpm --filter @mm/hotel exec tsx scripts/backfill-kitchen-roles.ts
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema/index';
import { roleCan } from '../src/lib/authz';
import { seedDefaultRoles } from '../src/lib/server/auth/seed-roles';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: 'snake_case' });

const CARRY_OVER: [from: string, to: string][] = [
	['dining:read', 'kitchen:read'],
	['dining:write', 'kitchen:write'],
	['dining:manage', 'kitchen:manage']
];

async function main() {
	const hotels = await db.select().from(schema.hotels);
	for (const hotel of hotels) await seedDefaultRoles(db, hotel.id);
	console.log(`Checked the Kitchen role for ${hotels.length} hotel(s).`);

	const perms = await db.select().from(schema.rolePermissions);
	const capsOf = new Map<string, string[]>();
	for (const p of perms) capsOf.set(p.roleId, [...(capsOf.get(p.roleId) ?? []), p.capability]);

	let added = 0;
	for (const role of await db.select().from(schema.roles)) {
		const caps = capsOf.get(role.id) ?? [];
		for (const [from, to] of CARRY_OVER) {
			if (!roleCan(caps, from) || roleCan(caps, to)) continue;
			await db
				.insert(schema.rolePermissions)
				.values({ roleId: role.id, capability: to })
				.onConflictDoNothing();
			caps.push(to);
			added++;
			console.log(`  role "${role.slug}" (${role.hotelId.slice(0, 8)}): + ${to}`);
		}
	}
	console.log(`Added ${added} kitchen capability grant(s).`);
}

main()
	.catch((e) => {
		console.error(e);
		process.exitCode = 1;
	})
	.finally(() => client.end());
