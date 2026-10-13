import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// HR, RBAC and audit are simulated: what is under test is that linking only touches personRef.
const { fetchAssignedMock } = vi.hoisted(() => ({ fetchAssignedMock: vi.fn() }));
vi.mock('$lib/server/hr-link/client', async (orig) => ({
	...(await orig<typeof import('$lib/server/hr-link/client')>()),
	fetchAssigned: fetchAssignedMock
}));
vi.mock('$lib/server/auth/rbac', () => ({ requireCap: () => {} }));
vi.mock('$lib/server/audit', () => ({ writeAudit: async () => {} }));

const hasDb = Boolean(
	process.env.DATABASE_URL || (await import('$env/dynamic/private').then((m) => m.env.DATABASE_URL).catch(() => ''))
);

describe.skipIf(!hasDb)('Team linkMember / unlinkMember (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { hotels, hrPersonSnapshots, memberships, roles, users } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { seedDefaultRoles } = await import('$lib/server/auth/seed-roles');
	const { and, eq } = await import('drizzle-orm');
	const { actions } = await import('./+page.server');

	const tag = `lnk-${Math.random().toString(36).slice(2, 10)}`;
	let hotelId = '';
	let roleId = '';
	const uid: string[] = [];

	const call = (name: 'linkMember' | 'unlinkMember', body: Record<string, string>) =>
		(actions[name] as (e: unknown) => Promise<{ status?: number; data?: { error?: string } }>)({
			locals: { user: { id: uid[0] }, role: {}, hotel: { id: hotelId } },
			request: { formData: async () => new URLSearchParams(body) }
		});
	const refOf = async (i: number) =>
		(await db.select({ r: memberships.personRef }).from(memberships).where(and(eq(memberships.hotelId, hotelId), eq(memberships.userId, uid[i]!))))[0]?.r;

	beforeAll(async () => {
		const [h] = await db.insert(hotels).values({ slug: tag, name: 'Link test', orgRef: mintRef('org') }).returning({ id: hotels.id });
		hotelId = h!.id;
		await seedDefaultRoles(db, hotelId);
		roleId = (await db.select({ id: roles.id }).from(roles).where(eq(roles.hotelId, hotelId)))[0]!.id;
		for (const n of [0, 1]) {
			const [u] = await db.insert(users).values({ email: `${tag}-${n}@example.test`, name: `U${n}`, passwordHash: 'x' }).returning({ id: users.id });
			uid.push(u!.id);
			await db.insert(memberships).values({ userId: u!.id, hotelId, roleId });
		}
		fetchAssignedMock.mockResolvedValue([
			{ person_ref: 'per_A', status: 'active', first_name: 'Ana', last_name: 'Cruz', employee_no: 'E-1', position: 'Cook', department: null },
			{ person_ref: 'per_GONE', status: 'separated', first_name: 'G', last_name: 'One', employee_no: 'E-2', position: null, department: null }
		]);
	});
	afterAll(async () => {
		await db.delete(hotels).where(eq(hotels.id, hotelId));
		for (const id of uid) await db.delete(users).where(eq(users.id, id));
	});

	it('links an existing login without touching its role', async () => {
		await call('linkMember', { userId: uid[0]!, personRef: 'per_A' });
		expect(await refOf(0)).toBe('per_A');
		const m = (await db.select({ r: memberships.roleId }).from(memberships).where(eq(memberships.userId, uid[0]!)))[0];
		expect(m?.r).toBe(roleId);
	});

	it('keeps a display snapshot of the HR name and position, even after unlinking', async () => {
		const [snap] = await db.select().from(hrPersonSnapshots).where(and(eq(hrPersonSnapshots.hotelId, hotelId), eq(hrPersonSnapshots.personRef, 'per_A')));
		expect(snap).toMatchObject({ fullName: 'Ana Cruz', position: 'Cook', employeeNo: 'E-1' });
	});

	it('refuses a person who is not active at this hotel, or already linked elsewhere', async () => {
		expect((await call('linkMember', { userId: uid[1]!, personRef: 'per_GONE' })).status).toBe(400);
		expect((await call('linkMember', { userId: uid[1]!, personRef: 'per_NOPE' })).status).toBe(400);
		expect((await call('linkMember', { userId: uid[1]!, personRef: 'per_A' })).status).toBe(400);
		expect(await refOf(1)).toBeNull();
	});

	it('unlinks', async () => {
		await call('unlinkMember', { userId: uid[0]! });
		expect(await refOf(0)).toBeNull();
	});
});
