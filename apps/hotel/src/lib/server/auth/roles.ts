import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index';
import type { db as Db } from '../db/index';
import { memberships, roles, rolePermissions } from '../db/schema/index';
import { MEMBERSHIP_ROLES, ROLE_CAPS } from '$lib/authz';
import { writeAudit } from '../audit';
import type { SessionUser } from './session';

type DbLike = typeof Db;

export class RoleError extends Error {}

function slugifyRoleName(name: string): string {
	const base = name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-+|-+$)/g, '');
	return base || 'role';
}

/** Appends `-2`, `-3`, … on collision — `roles.slug` is only unique per hotel, so two
 *  hotels (or two custom roles named "Cashier" and "cashier!!") can't collide with
 *  each other, only within the same hotel. */
async function uniqueRoleSlug(hotelId: string, base: string): Promise<string> {
	let slug = base;
	let n = 2;
	// A handful of roles per hotel at most — a loop is simpler than a clever query.
	for (;;) {
		const clash = await db
			.select({ id: roles.id })
			.from(roles)
			.where(and(eq(roles.hotelId, hotelId), eq(roles.slug, slug)))
			.then((r) => r.at(0));
		if (!clash) return slug;
		slug = `${base}-${n++}`;
	}
}

export interface RoleWithCaps {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	isProtected: boolean;
	capabilities: string[];
	memberCount: number;
}

/** Every role for a hotel (seeded + custom), each with its resolved capability list
 *  and how many members currently hold it — the member count is what the UI uses to
 *  decide whether a role can be deleted outright or must be reassigned first. */
export async function listRolesWithCaps(hotelId: string): Promise<RoleWithCaps[]> {
	const roleRows = await db
		.select({
			id: roles.id,
			slug: roles.slug,
			name: roles.name,
			description: roles.description,
			isProtected: roles.isProtected
		})
		.from(roles)
		.where(eq(roles.hotelId, hotelId));
	if (roleRows.length === 0) return [];

	const roleIds = roleRows.map((r) => r.id);
	const [perms, memberRows] = await Promise.all([
		db
			.select({ roleId: rolePermissions.roleId, capability: rolePermissions.capability })
			.from(rolePermissions)
			.where(inArray(rolePermissions.roleId, roleIds)),
		db
			.select({ roleId: memberships.roleId })
			.from(memberships)
			.where(inArray(memberships.roleId, roleIds))
	]);

	const capsByRole = new Map<string, string[]>();
	for (const p of perms) capsByRole.set(p.roleId, [...(capsByRole.get(p.roleId) ?? []), p.capability]);
	const countByRole = new Map<string, number>();
	for (const m of memberRows) countByRole.set(m.roleId, (countByRole.get(m.roleId) ?? 0) + 1);

	return roleRows
		.map((r) => ({
			...r,
			capabilities: capsByRole.get(r.id) ?? [],
			memberCount: countByRole.get(r.id) ?? 0
		}))
		.sort((a, b) => (b.isProtected ? 1 : 0) - (a.isProtected ? 1 : 0) || a.name.localeCompare(b.name));
}

export async function createCustomRole(
	hotelId: string,
	input: { name: string; description?: string | null; capabilities: string[] },
	actor: SessionUser | null
): Promise<RoleWithCaps> {
	const name = input.name.trim();
	if (!name) throw new RoleError('Give the role a name.');
	if (input.capabilities.length === 0) throw new RoleError('Pick at least one permission.');
	const slug = await uniqueRoleSlug(hotelId, slugifyRoleName(name));

	const row = await db.transaction(async (tx) => {
		const [r] = await tx
			.insert(roles)
			.values({ hotelId, slug, name, description: input.description || null, isProtected: false })
			.returning();
		await tx
			.insert(rolePermissions)
			.values(input.capabilities.map((capability) => ({ roleId: r!.id, capability })));
		return r!;
	});
	await writeAudit({
		hotelId,
		actor,
		action: 'role.create',
		entityType: 'role',
		entityId: row.id,
		after: { name, capabilities: input.capabilities }
	});
	return { ...row, capabilities: input.capabilities, memberCount: 0 };
}

async function getEditableRoleOr404(hotelId: string, roleId: string) {
	const role = await db
		.select()
		.from(roles)
		.where(and(eq(roles.id, roleId), eq(roles.hotelId, hotelId)))
		.then((r) => r.at(0));
	if (!role) throw new RoleError('Role not found.');
	if (role.isProtected) throw new RoleError('The Hotel Admin role can’t be changed.');
	return role;
}

export async function updateCustomRole(
	hotelId: string,
	roleId: string,
	input: { name: string; description?: string | null; capabilities: string[] },
	actor: SessionUser | null
): Promise<void> {
	await getEditableRoleOr404(hotelId, roleId);
	const name = input.name.trim();
	if (!name) throw new RoleError('Give the role a name.');
	if (input.capabilities.length === 0) throw new RoleError('Pick at least one permission.');

	await db.transaction(async (tx) => {
		await tx
			.update(roles)
			.set({ name, description: input.description || null, updatedAt: new Date() })
			.where(eq(roles.id, roleId));
		await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
		await tx
			.insert(rolePermissions)
			.values(input.capabilities.map((capability) => ({ roleId, capability })));
	});
	await writeAudit({
		hotelId,
		actor,
		action: 'role.update',
		entityType: 'role',
		entityId: roleId,
		after: { name, capabilities: input.capabilities }
	});
}

export async function deleteCustomRole(
	hotelId: string,
	roleId: string,
	actor: SessionUser | null
): Promise<void> {
	await getEditableRoleOr404(hotelId, roleId);
	const holder = await db
		.select({ userId: memberships.userId })
		.from(memberships)
		.where(eq(memberships.roleId, roleId))
		.limit(1)
		.then((r) => r.at(0));
	if (holder) throw new RoleError('Reassign everyone with this role before deleting it.');

	await db.delete(roles).where(eq(roles.id, roleId));
	await writeAudit({ hotelId, actor, action: 'role.delete', entityType: 'role', entityId: roleId });
}

const ROLE_LABELS: Record<string, string> = {
	hotel_admin: 'Hotel Admin',
	front_desk: 'Front Desk',
	housekeeping: 'Housekeeping',
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
