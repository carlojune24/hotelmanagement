/**
 * One-time backfill for dining's own till: the `dining` role gained `dining:shift`
 * ("Open and close the dining drawer") in `ROLE_CAPS`, but `seedDefaultRoles` only ever
 * *creates* roles — it skips a slug the hotel already has, so an existing hotel's Dining
 * role never picked the new capability up. Without it a dining account sees no Drawer tab
 * and no Open shift control, with no hint why.
 *
 * Adds `dining:shift` to any role that can already take dining payments (`dining:write`),
 * which is the role running the register. Additive and idempotent: nothing is ever removed,
 * a role that already has it (directly or through a wildcard) is left alone, and re-running
 * changes nothing.
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

	let added = 0;
	for (const role of await db.select().from(schema.roles)) {
		const caps = capsOf.get(role.id) ?? [];
		if (!roleCan(caps, 'dining:write') || roleCan(caps, 'dining:shift')) continue;
		await db
			.insert(schema.rolePermissions)
			.values({ roleId: role.id, capability: 'dining:shift' })
			.onConflictDoNothing();
		added++;
		console.log(`  role "${role.slug}" (${role.hotelId.slice(0, 8)}): + dining:shift`);
	}
	console.log(
		added === 0
			? 'Every role that runs the dining register already opens its drawer — nothing to do.'
			: `Added dining:shift to ${added} role(s). They need to sign out and back in.`
	);
}

main()
	.catch((e) => {
		console.error(e);
		process.exitCode = 1;
	})
	.finally(() => client.end());
