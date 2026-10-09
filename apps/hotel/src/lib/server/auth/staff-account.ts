import { and, eq } from 'drizzle-orm';
import type { db as Db } from '../db/index';
import { hotels, memberships, rolePermissions, roles, users } from '../db/schema/index';
import { ROLE_CAPS } from '../../authz';
import { seedDefaultRoles } from './seed-roles';

// Imports are relative and type-only for the database on purpose: the scripts that call this run under
// plain tsx, which knows neither the `$lib` alias nor SvelteKit's `$env`.
type DbLike = typeof Db;

/** The single-purpose staff accounts: each sees one section of the working hotel and nothing else. */
export type StaffRole = 'kitchen' | 'dining';
const LABEL: Record<StaffRole, string> = { kitchen: 'Kitchen', dining: 'Dining' };

export interface StaffAccountOptions {
	hotelSlug: string;
	email: string;
	name: string;
	password: string;
	/** Injected so the script can hash with the same pepper the app uses (this file stays free of `$env`). */
	hashPassword: (password: string) => Promise<string>;
	verifyPassword: (digest: string, password: string) => Promise<boolean>;
	/** Take over an account that is a platform admin, holds another role here, or is disabled. */
	force?: boolean;
	/** Set the password even though the account already exists (otherwise an existing password is kept). */
	resetPassword?: boolean;
	/**
	 * Add any capability the role's default now has but this hotel's copy of the role lacks (e.g. the
	 * Dining role gained `dining:manage`). Only ever adds, so a hotel admin's removals elsewhere stay.
	 */
	syncCapabilities?: boolean;
}

export interface StaffAccountResult {
	userId: string;
	hotelId: string;
	email: string;
	createdUser: boolean;
	membershipChanged: boolean;
	passwordSet: boolean;
	/** Capabilities added to the role by `syncCapabilities`. */
	capabilitiesAdded: string[];
}

/**
 * Creates (or repairs) a single-section staff account: a user whose one membership at one hotel is the
 * `kitchen` or `dining` role. Idempotent: running it again changes nothing. It will not quietly turn a
 * manager or platform admin into one, nor reset a password somebody has already changed, unless told to.
 */
export async function ensureStaffAccount(
	db: DbLike,
	roleSlug: StaffRole,
	o: StaffAccountOptions
): Promise<StaffAccountResult> {
	const label = LABEL[roleSlug];
	const email = o.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`"${o.email}" is not a valid email address.`);
	if (o.password.length < 8) throw new Error('The password must be at least 8 characters.');

	const [hotel] = await db.select({ id: hotels.id }).from(hotels).where(eq(hotels.slug, o.hotelSlug)).limit(1);
	if (!hotel) throw new Error(`No hotel with the slug "${o.hotelSlug}".`);

	// Adds whichever default roles this hotel is missing (e.g. one that predates the Dining role).
	await seedDefaultRoles(db, hotel.id);
	const [role] = await db
		.select({ id: roles.id })
		.from(roles)
		.where(and(eq(roles.hotelId, hotel.id), eq(roles.slug, roleSlug)))
		.limit(1);
	if (!role) throw new Error(`The ${label} role could not be created for this hotel.`);

	let capabilitiesAdded: string[] = [];
	if (o.syncCapabilities) {
		const have = new Set(
			(await db.select({ c: rolePermissions.capability }).from(rolePermissions).where(eq(rolePermissions.roleId, role.id))).map((r) => r.c)
		);
		capabilitiesAdded = ROLE_CAPS[roleSlug].filter((c) => !have.has(c));
		if (capabilitiesAdded.length > 0) {
			await db.insert(rolePermissions).values(capabilitiesAdded.map((capability) => ({ roleId: role.id, capability })));
		}
	}

	const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
	const [membership] = existing
		? await db
				.select({ roleId: memberships.roleId })
				.from(memberships)
				.where(and(eq(memberships.userId, existing.id), eq(memberships.hotelId, hotel.id)))
				.limit(1)
		: [];

	if (existing && !o.force) {
		if (existing.isPlatformAdmin) throw new Error(`${email} is a platform admin. Use --force to make it a ${label.toLowerCase()} account.`);
		if (existing.status !== 'active') throw new Error(`${email} is disabled. Use --force to re-enable it.`);
		if (membership && membership.roleId !== role.id) {
			throw new Error(`${email} already has a different role at this hotel. Use --force to change it to ${label}.`);
		}
	}

	let userId: string;
	let passwordSet = false;
	if (!existing) {
		const [row] = await db
			.insert(users)
			.values({ email, name: o.name, passwordHash: await o.hashPassword(o.password), isPlatformAdmin: false, status: 'active' })
			.returning({ id: users.id });
		userId = row!.id;
		passwordSet = true;
	} else {
		userId = existing.id;
		const patch: Partial<typeof users.$inferInsert> = {};
		if (existing.isPlatformAdmin) patch.isPlatformAdmin = false;
		if (existing.status !== 'active') patch.status = 'active';
		if (o.resetPassword || !existing.passwordHash) {
			patch.passwordHash = await o.hashPassword(o.password);
			passwordSet = true;
		}
		if (Object.keys(patch).length > 0) await db.update(users).set(patch).where(eq(users.id, userId));
	}

	const membershipChanged = !membership || membership.roleId !== role.id;
	if (membershipChanged) {
		await db
			.insert(memberships)
			.values({ userId, hotelId: hotel.id, roleId: role.id })
			.onConflictDoUpdate({ target: [memberships.userId, memberships.hotelId], set: { roleId: role.id } });
	}

	// Prove the stored password works the way the login screen will check it (same pepper), so a
	// mismatch is caught here and not at the login screen.
	if (passwordSet) {
		const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
		if (!row?.passwordHash || !(await o.verifyPassword(row.passwordHash, o.password))) {
			throw new Error('The saved password does not verify. Check AUTH_PEPPER and try again.');
		}
	}

	return { userId, hotelId: hotel.id, email, createdUser: !existing, membershipChanged, passwordSet, capabilitiesAdded };
}

export const ensureKitchenAccount = (db: DbLike, o: StaffAccountOptions) => ensureStaffAccount(db, 'kitchen', o);
export const ensureDiningAccount = (db: DbLike, o: StaffAccountOptions) => ensureStaffAccount(db, 'dining', o);
