import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// HR itself is simulated: the hotel's rules are what is under test, not the network.
const { fetchPeopleMock } = vi.hoisted(() => ({ fetchPeopleMock: vi.fn() }));
vi.mock('./client', async (orig) => ({
	...(await orig<typeof import('./client')>()),
	fetchPeople: fetchPeopleMock
}));

import { HrLinkError, normalizeBaseUrl, type HrPerson } from './client';
import { fateOf } from './sync';

describe('normalizeBaseUrl', () => {
	it('keeps just the origin of an https address', () => {
		expect(normalizeBaseUrl(' https://hr.example.com/some/path?x=1 ')).toBe('https://hr.example.com');
	});
	it('allows plain http only for a local dev HR app', () => {
		expect(normalizeBaseUrl('http://localhost:5176')).toBe('http://localhost:5176');
		expect(() => normalizeBaseUrl('http://hr.example.com')).toThrow(HrLinkError);
	});
	it('rejects things that are not addresses', () => {
		expect(() => normalizeBaseUrl('not a url')).toThrow(HrLinkError);
		expect(() => normalizeBaseUrl('ftp://hr.example.com')).toThrow(HrLinkError);
	});
});

describe('fateOf', () => {
	it('only a clear separation or move removes access', () => {
		expect(fateOf({ status: 'active', assigned: true })).toBe('keep');
		expect(fateOf({ status: 'separated', assigned: true })).toBe('remove');
		expect(fateOf({ status: 'active', assigned: false })).toBe('remove');
	});
	it('a person HR does not recognise is never removed', () => {
		expect(fateOf(undefined)).toBe('unknown');
	});
});

const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());
async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

const person = (ref: string, over: Partial<HrPerson> = {}): HrPerson => ({
	person_ref: ref,
	employee_no: ref,
	first_name: 'F',
	last_name: ref,
	email: null,
	status: 'active',
	position: 'Cook',
	department: null,
	assigned: true,
	...over
});

describe.skipIf(!hasDb)('syncHrLinkedMembers (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { hotels, invites, memberships, roles, users } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { seedDefaultRoles } = await import('$lib/server/auth/seed-roles');
	const { syncHrLinkedMembers } = await import('./sync');
	const { and, eq, inArray } = await import('drizzle-orm');

	const tag = `hrsync-${Math.random().toString(36).slice(2, 10)}`;
	let hotelId = '';
	const userIds: Record<string, string> = {};

	const hasMembership = async (key: string) =>
		(await db.select().from(memberships).where(and(eq(memberships.hotelId, hotelId), eq(memberships.userId, userIds[key]!)))).length > 0;

	beforeAll(async () => {
		const [h] = await db
			.insert(hotels)
			.values({ slug: tag, name: 'HR sync test', orgRef: mintRef('org') })
			.returning({ id: hotels.id });
		hotelId = h!.id;
		await seedDefaultRoles(db, hotelId);
		const roleRows = await db.select().from(roles).where(eq(roles.hotelId, hotelId));
		const roleId = (slug: string) => roleRows.find((r) => r.slug === slug)!.id;

		const mk = async (key: string, roleSlug: string, personRef: string | null) => {
			const [u] = await db
				.insert(users)
				.values({ email: `${tag}-${key}@example.com`, name: key })
				.returning({ id: users.id });
			userIds[key] = u!.id;
			await db
				.insert(memberships)
				.values({ userId: u!.id, hotelId, roleId: roleId(roleSlug), personRef });
		};
		await mk('left', 'front_desk', 'per_LEFT');
		await mk('moved', 'front_desk', 'per_MOVED');
		await mk('stays', 'front_desk', 'per_STAYS');
		await mk('admin', 'hotel_admin', 'per_ADMIN');
		await mk('mystery', 'front_desk', 'per_MYSTERY');
		await mk('unlinked', 'front_desk', null);

		await db.insert(invites).values({
			email: `${tag}-pending@example.com`,
			tokenHash: `${tag}-hash`,
			hotelId,
			role: 'front_desk',
			personRef: 'per_PENDINGGONE',
			expiresAt: new Date(Date.now() + 86_400_000)
		});
	});
	afterAll(async () => {
		await db.delete(invites).where(eq(invites.hotelId, hotelId));
		await db.delete(hotels).where(eq(hotels.id, hotelId)); // memberships/roles cascade
		await db.delete(users).where(inArray(users.id, Object.values(userIds)));
	});

	it('removes access for the separated and the moved — and only them', async () => {
		fetchPeopleMock.mockResolvedValueOnce([
			person('per_LEFT', { status: 'separated' }),
			person('per_MOVED', { assigned: false, position: null }),
			person('per_STAYS'),
			person('per_ADMIN', { assigned: false }),
			person('per_PENDINGGONE', { status: 'separated' })
			// per_MYSTERY: HR returns nothing for it
		]);
		const r = await syncHrLinkedMembers(hotelId);

		expect(r.error).toBeNull();
		expect(r.removed.map((x) => x.email).sort()).toEqual([`${tag}-left@example.com`, `${tag}-moved@example.com`]);
		expect(await hasMembership('left')).toBe(false);
		expect(await hasMembership('moved')).toBe(false);
		expect(await hasMembership('stays')).toBe(true);
		expect(await hasMembership('unlinked')).toBe(true); // never linked: not HR's to touch
	});

	it('leaves a hotel admin in place but says so', async () => {
		expect(await hasMembership('admin')).toBe(true);
	});

	it('leaves a person HR does not recognise alone', async () => {
		expect(await hasMembership('mystery')).toBe(true);
	});

	it('revokes a pending invite for someone HR no longer has here', async () => {
		const [inv] = await db.select().from(invites).where(eq(invites.hotelId, hotelId));
		expect(inv!.status).toBe('revoked');
	});

	it('changes nothing at all when HR cannot be reached', async () => {
		fetchPeopleMock.mockRejectedValueOnce(new HrLinkError('unreachable', "Couldn't reach HR."));
		const before = await db.select().from(memberships).where(eq(memberships.hotelId, hotelId));
		const r = await syncHrLinkedMembers(hotelId);
		const after = await db.select().from(memberships).where(eq(memberships.hotelId, hotelId));

		expect(r.error).toMatch(/reach/i);
		expect(r.removed).toEqual([]);
		expect(after).toHaveLength(before.length);
	});

	it('reports a hotel admin that HR no longer lists as protected', async () => {
		fetchPeopleMock.mockResolvedValueOnce([person('per_ADMIN', { assigned: false }), person('per_STAYS'), person('per_MYSTERY')]);
		const r = await syncHrLinkedMembers(hotelId);
		expect(r.protectedKept.map((x) => x.email)).toEqual([`${tag}-admin@example.com`]);
	});
});
