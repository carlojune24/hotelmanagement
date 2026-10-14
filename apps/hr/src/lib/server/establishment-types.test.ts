import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, testOrgId } from './hr/test-helpers';

const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());
async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

describe.skipIf(!hasDb)('establishment types (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { establishmentTypes } = await import('$lib/server/db/schema/index');
	const { eq, like } = await import('drizzle-orm');
	const T = await import('./establishment-types');
	const E = await import('./establishments');

	const tag = `ty${Math.random().toString(36).slice(2, 8)}`;
	const org = await testOrgId();
	const made: string[] = [];

	afterAll(async () => {
		await cleanupTestEstablishments(made);
		await db.delete(establishmentTypes).where(like(establishmentTypes.name, `%${tag}%`));
	});

	it('starts with Hotel (linked to the hotel app) and Other (HR only)', async () => {
		const types = await T.listEstablishmentTypes(org);
		expect(types.find((t) => t.name === 'Hotel')).toMatchObject({ linksToHotelApp: true, active: true });
		expect(types.find((t) => t.name === 'Other')).toMatchObject({ linksToHotelApp: false });
	});

	it('adds a type, rejects a duplicate name, and derives the establishment kind from it', async () => {
		const cafe = await T.createEstablishmentType(org, { name: `Cafe ${tag}`, linksToHotelApp: false });
		await expect(T.createEstablishmentType(org, { name: `cafe ${tag}`, linksToHotelApp: false })).rejects.toThrow(/already exists/);

		const est = await E.createEstablishment({ name: `Cafe test ${tag}`, typeId: cafe.id, timezone: 'Asia/Manila' });
		made.push(est.id);
		expect(est).toMatchObject({ kind: 'business', typeId: cafe.id });
	});

	it('keeps a hotel a hotel, lets non-hotel types switch, and refuses a retired type for new ones', async () => {
		const types = await T.listEstablishmentTypes(org);
		const hotel = types.find((t) => t.name === 'Hotel')!;
		const other = types.find((t) => t.name === 'Other')!;
		const cafe = types.find((t) => t.name === `Cafe ${tag}`)!;

		const h = await E.createEstablishment({ name: `Hotel test ${tag}`, typeId: hotel.id, timezone: 'Asia/Manila' });
		made.push(h.id);
		expect(h.kind).toBe('hotel');
		await expect(E.updateEstablishment(h.id, { name: h.name, timezone: 'Asia/Manila', typeId: cafe.id })).rejects.toThrow(/cannot be changed/);

		const [biz] = await db.select().from((await import('$lib/server/db/schema/index')).establishments).where(eq((await import('$lib/server/db/schema/index')).establishments.id, made[0]!));
		const moved = await E.updateEstablishment(biz!.id, { name: biz!.name, timezone: 'Asia/Manila', typeId: other.id });
		expect(moved.typeId).toBe(other.id);

		await T.updateEstablishmentType(org, cafe.id, { name: cafe.name, active: false });
		await expect(E.createEstablishment({ name: `Late ${tag}`, typeId: cafe.id, timezone: 'Asia/Manila' })).rejects.toThrow(/in use/);
	});
});
