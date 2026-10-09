import { eq } from 'drizzle-orm';
import type { db as Db } from '../db/index';
import { roles, rolePermissions } from '../db/schema/index';
// Relative imports and a type-only database import on purpose: this runs under plain tsx (seed and
// setup scripts), which knows neither the `$lib` alias nor SvelteKit's `$env`.
import { MEMBERSHIP_ROLES, ROLE_CAPS } from '../../authz';

type DbLike = typeof Db;

const ROLE_LABELS: Record<string, string> = {
	hotel_admin: 'Hotel Admin',
	front_desk: 'Front Desk',
	housekeeping: 'Housekeeping',
	dining: 'Dining',
	kitchen: 'Kitchen',
	accountant: 'Accountant',
	hr: 'HR',
	read_only: 'Read Only',
	group_owner: 'Group Owner'
};

/** Copies the legacy `ROLE_CAPS` seed catalog into concrete `roles`/`role_permissions` rows
 *  for one hotel. Idempotent — safe to call again for a hotel that already has roles (e.g.
 *  the one-off backfill script re-run). Used both at hotel-creation time and by that backfill. */
export async function seedDefaultRoles(db: DbLike, hotelId: string): Promise<void> {
	const existing = await db
		.select({ slug: roles.slug })
		.from(roles)
		.where(eq(roles.hotelId, hotelId));
	const existingSlugs = new Set(existing.map((r) => r.slug));

	// group_owner is portfolio-level (Phase 6), not assignable at a single hotel — skip it here.
	const toSeed = MEMBERSHIP_ROLES.filter((slug) => slug !== 'group_owner' && !existingSlugs.has(slug));
	if (toSeed.length === 0) return;

	await db.transaction(async (tx) => {
		for (const slug of toSeed) {
			const [row] = await tx
				.insert(roles)
				.values({
					hotelId,
					slug,
					name: ROLE_LABELS[slug] ?? slug,
					isProtected: slug === 'hotel_admin'
				})
				.returning({ id: roles.id });

			const caps = ROLE_CAPS[slug];
			if (caps.length > 0) {
				await tx.insert(rolePermissions).values(caps.map((capability) => ({ roleId: row!.id, capability })));
			}
		}
	});
}
