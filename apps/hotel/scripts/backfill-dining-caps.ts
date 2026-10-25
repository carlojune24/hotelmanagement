/**
 * One-time backfill for the dining register's own capabilities — `dining:shift` (open and close
 * the dining drawer) and `dining:sell` (the Quick sale till). Both were added to `ROLE_CAPS`
 * after the fact, and `seedDefaultRoles` only ever *creates* roles: it skips a slug the hotel
 * already has, so an existing hotel's Dining role never picks a new capability up. Without this,
 * a dining account loses the Drawer tab and the Quick sale tab with no hint why.
 *
 * Grants them to any role that can already take dining payments (`dining:write`) — the role
 * running the register. Additive and idempotent: nothing is ever removed, a role that already
 * has one (directly or through a wildcard) is left alone, and re-running changes nothing.
 *
 *   pnpm --filter @mm/hotel exec tsx scripts/backfill-dining-caps.ts
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema/index';
import { roleCan } from '../src/lib/authz';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: 'snake_case' });

async function main() {
	const perms = await db.select().from(schema.rolePermissions);
	const capsOf = new Map<string, string[]>();
	for (const p of perms) capsOf.set(p.roleId, [...(capsOf.get(p.roleId) ?? []), p.capability]);

	const REGISTER_CAPS = ['dining:shift', 'dining:sell'];

	let added = 0;
	for (const role of await db.select().from(schema.roles)) {
		const caps = capsOf.get(role.id) ?? [];
		if (!roleCan(caps, 'dining:write')) continue;
		for (const cap of REGISTER_CAPS) {
			if (roleCan(caps, cap)) continue;
			await db
				.insert(schema.rolePermissions)
				.values({ roleId: role.id, capability: cap })
				.onConflictDoNothing();
			caps.push(cap);
			added++;
			console.log(`  role "${role.slug}" (${role.hotelId.slice(0, 8)}): + ${cap}`);
		}
	}
	console.log(
		added === 0
			? 'Every role that runs the dining register already has its drawer and its till — nothing to do.'
			: `Added ${added} capability grant(s). Those accounts need to sign out and back in.`
	);
}

main()
	.catch((e) => {
		console.error(e);
		process.exitCode = 1;
	})
	.finally(() => client.end());
