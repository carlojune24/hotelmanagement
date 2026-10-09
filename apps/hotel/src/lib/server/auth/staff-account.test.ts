import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';

/** The kitchen-only account: created once, locked to the Kitchen role, never quietly takes over somebody
 *  else's account. Own throwaway hotel and users; skipped without a database. */
const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());

async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

describe.skipIf(!hasDb)('kitchen and dining accounts (live DB)', async () => {
	const { db } = await import('../db/index');
	const s = await import('../db/schema/index');
	const { mintRef } = await import('../ids');
	const { ensureKitchenAccount, ensureDiningAccount } = await import('./staff-account');
	const { ROLE_CAPS, isKitchenOnly } = await import('../../authz');
	const { hash, verify } = await import('@node-rs/argon2');

	const argon = { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 } as const;
	const PEPPER = 'test-pepper';
	const tag = `kitchenacct-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	const emails: string[] = [];
	let slug = '';
	let otherSlug = '';

	const opts = (email: string, extra: Record<string, unknown> = {}) => ({
		hotelSlug: slug,
		email,
		name: 'Kitchen',
		password: 'kitchen12345',
		hashPassword: (pw: string) => hash(pw + PEPPER, argon),
		verifyPassword: (digest: string, pw: string) => verify(digest, pw + PEPPER, argon),
		...extra
	});
	const mail = (n: string) => {
		const e = `${tag}-${n}@example.com`;
		emails.push(e);
		return e;
	};
	const rolesOf = async (userId: string, hotelId: string) =>
		(
			await db
				.select({ slug: s.roles.slug })
				.from(s.memberships)
				.innerJoin(s.roles, eq(s.roles.id, s.memberships.roleId))
				.where(and(eq(s.memberships.userId, userId), eq(s.memberships.hotelId, hotelId)))
		).map((r) => r.slug);

	beforeAll(async () => {
		const [h] = await db.insert(s.hotels).values({ slug: `${tag}-a`, name: 'Kitchen test A', orgRef: mintRef('org') }).returning();
		const [o] = await db.insert(s.hotels).values({ slug: `${tag}-b`, name: 'Kitchen test B', orgRef: mintRef('org') }).returning();
		hotelIds.push(h!.id, o!.id);
		slug = h!.slug;
		otherSlug = o!.slug;
	});

	afterAll(async () => {
		if (emails.length) await db.delete(s.users).where(inArray(s.users.email, emails));
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	it('creates the user with only the Kitchen role, and the password checks out with the pepper', async () => {
		const email = mail('new');
		const r = await ensureKitchenAccount(db, opts(email));
		expect(r).toMatchObject({ createdUser: true, membershipChanged: true, passwordSet: true, email });

		const [u] = await db.select().from(s.users).where(eq(s.users.email, email));
		expect(u).toMatchObject({ isPlatformAdmin: false, status: 'active' });
		expect(await verify(u!.passwordHash!, 'kitchen12345' + PEPPER, argon)).toBe(true);
		expect(await verify(u!.passwordHash!, 'kitchen12345', argon)).toBe(false); // the pepper is part of it

		expect(await rolesOf(u!.id, r.hotelId)).toEqual(['kitchen']);
		const caps = await db
			.select({ c: s.rolePermissions.capability })
			.from(s.rolePermissions)
			.innerJoin(s.memberships, eq(s.memberships.roleId, s.rolePermissions.roleId))
			.where(eq(s.memberships.userId, u!.id));
		expect(caps.map((c) => c.c).sort()).toEqual(['kitchen:read', 'kitchen:write']);
		expect(isKitchenOnly(caps.map((c) => c.c))).toBe(true);
		expect(ROLE_CAPS.kitchen).toEqual(['kitchen:read', 'kitchen:write']);
	});

	it('lowercases the email and changes nothing when run again', async () => {
		const email = mail('again');
		await ensureKitchenAccount(db, opts(email.toUpperCase()));
		const second = await ensureKitchenAccount(db, opts(email));
		expect(second).toMatchObject({ createdUser: false, membershipChanged: false, passwordSet: false });
		expect((await db.select().from(s.users).where(eq(s.users.email, email))).length).toBe(1);
	});

	it('keeps a password somebody changed unless asked to reset it', async () => {
		const email = mail('pw');
		await ensureKitchenAccount(db, opts(email));
		const changed = await hash('their-own-password' + PEPPER, argon);
		await db.update(s.users).set({ passwordHash: changed }).where(eq(s.users.email, email));

		await ensureKitchenAccount(db, opts(email));
		expect((await db.select().from(s.users).where(eq(s.users.email, email)))[0]!.passwordHash).toBe(changed);

		const r = await ensureKitchenAccount(db, opts(email, { resetPassword: true }));
		expect(r.passwordSet).toBe(true);
		const [u] = await db.select().from(s.users).where(eq(s.users.email, email));
		expect(await verify(u!.passwordHash!, 'kitchen12345' + PEPPER, argon)).toBe(true);
	});

	it('will not turn a platform admin, a manager or a disabled account into a cook without --force', async () => {
		const admin = mail('admin');
		await db.insert(s.users).values({ email: admin, name: 'A', isPlatformAdmin: true });
		await expect(ensureKitchenAccount(db, opts(admin))).rejects.toThrow(/platform admin/);

		const manager = mail('manager');
		await ensureKitchenAccount(db, opts(manager)); // creates the user at hotel A
		// The hotel's default roles were seeded when the account was made, including the manager's.
		const [role] = await db.select({ id: s.roles.id }).from(s.roles).where(and(eq(s.roles.hotelId, hotelIds[0]!), eq(s.roles.slug, 'hotel_admin')));
		const [mu] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, manager));
		await db.update(s.memberships).set({ roleId: role!.id }).where(eq(s.memberships.userId, mu!.id));
		await expect(ensureKitchenAccount(db, opts(manager))).rejects.toThrow(/different role/);
		expect(await rolesOf(mu!.id, hotelIds[0]!)).toEqual(['hotel_admin']); // untouched

		const off = mail('off');
		await db.insert(s.users).values({ email: off, name: 'Off', status: 'disabled' });
		await expect(ensureKitchenAccount(db, opts(off))).rejects.toThrow(/disabled/);

		const forced = await ensureKitchenAccount(db, opts(manager, { force: true }));
		expect(forced.membershipChanged).toBe(true);
		expect(await rolesOf(mu!.id, hotelIds[0]!)).toEqual(['kitchen']);
	});

	it('is scoped to one hotel, and says so when the hotel does not exist', async () => {
		const email = mail('scope');
		const r = await ensureKitchenAccount(db, opts(email));
		expect(await rolesOf(r.userId, hotelIds[1]!)).toEqual([]); // no access to the other hotel
		await expect(ensureKitchenAccount(db, opts(mail('x'), { hotelSlug: `${tag}-missing` }))).rejects.toThrow(/No hotel/);
		void otherSlug;
	});

	it('rejects a bad email or a short password before touching anything', async () => {
		await expect(ensureKitchenAccount(db, opts('not-an-email'))).rejects.toThrow(/valid email/);
		await expect(ensureKitchenAccount(db, opts(mail('short'), { password: 'short' }))).rejects.toThrow(/at least 8/);
	});

	it('tops a role up with a permission its default gained, only when asked, and never removes one', async () => {
		const email = mail('sync');
		const r = await ensureDiningAccount(db, opts(email));
		const [member] = await db.select({ roleId: s.memberships.roleId }).from(s.memberships).where(eq(s.memberships.userId, r.userId));
		// An older copy of the role: without manage, and with an extra permission an admin added.
		await db.delete(s.rolePermissions).where(and(eq(s.rolePermissions.roleId, member!.roleId), eq(s.rolePermissions.capability, 'dining:manage')));
		await db.insert(s.rolePermissions).values({ roleId: member!.roleId, capability: 'reports:read' });

		const plain = await ensureDiningAccount(db, opts(email));
		expect(plain.capabilitiesAdded).toEqual([]); // nothing changes unless asked

		const synced = await ensureDiningAccount(db, opts(email, { syncCapabilities: true }));
		expect(synced.capabilitiesAdded).toEqual(['dining:manage']);
		const caps = (await db.select({ c: s.rolePermissions.capability }).from(s.rolePermissions).where(eq(s.rolePermissions.roleId, member!.roleId))).map((c) => c.c).sort();
		expect(caps).toEqual(['dining:manage', 'dining:read', 'dining:write', 'reports:read']); // the admin's extra stays

		expect((await ensureDiningAccount(db, opts(email, { syncCapabilities: true }))).capabilitiesAdded).toEqual([]);
		// The role is shared by everyone with it at this hotel, so put it back for the tests that follow.
		await db.delete(s.rolePermissions).where(and(eq(s.rolePermissions.roleId, member!.roleId), eq(s.rolePermissions.capability, 'reports:read')));
	});

	it('makes a dining account with only the Dining role, and keeps it apart from the kitchen one', async () => {
		const email = mail('dining');
		const r = await ensureDiningAccount(db, opts(email, { password: 'dining12345' }));
		expect(r).toMatchObject({ createdUser: true, membershipChanged: true, passwordSet: true });
		expect(await rolesOf(r.userId, r.hotelId)).toEqual(['dining']);
		const caps = await db
			.select({ c: s.rolePermissions.capability })
			.from(s.rolePermissions)
			.innerJoin(s.memberships, eq(s.memberships.roleId, s.rolePermissions.roleId))
			.where(eq(s.memberships.userId, r.userId));
		expect(caps.map((c) => c.c).sort()).toEqual(['dining:manage', 'dining:read', 'dining:write']);

		// A kitchen account is not silently turned into a dining one, or the other way round.
		await expect(ensureKitchenAccount(db, opts(email))).rejects.toThrow(/different role/);
		const [u] = await db.select().from(s.users).where(eq(s.users.email, email));
		expect(await verify(u!.passwordHash!, 'dining12345' + PEPPER, argon)).toBe(true);
	});
});
