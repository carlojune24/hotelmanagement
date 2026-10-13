import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';

/**
 * Live-DB tests for what the hotel app is allowed to see: the people assigned to *its* establishment,
 * and the state of specific people it already linked — nothing else. Throwaway data, cleaned up.
 */
const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());

async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

describe.skipIf(!hasDb)('HR → hotel API (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { employees, establishments } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { assignedToEstablishment, peopleByRef } = await import('./api');
	const { assignEmployee, endAssignment } = await import('./registry');
	const { eq } = await import('drizzle-orm');

	const tag = `apitest-${Math.random().toString(36).slice(2, 10)}`;
	let A = '';
	let B = '';
	let ana = ''; // at A (and later B)
	let bo = ''; // at A only
	let cy = ''; // at B only
	const ref = async (id: string) =>
		(await db.select({ r: employees.personRef }).from(employees).where(eq(employees.id, id)))[0]!.r;

	const mkEst = async (suffix: string) => {
		const [e] = await db
			.insert(establishments)
			.values({
				organizationId: await testOrgId(),
				kind: 'hotel',
				slug: `${tag}-${suffix}`,
				name: `API test ${suffix}`,
				orgRef: mintRef('org')
			})
			.returning({ id: establishments.id });
		return e!.id;
	};

	beforeAll(async () => {
		A = await mkEst('a');
		B = await mkEst('b');
		ana = await createTestStaff(A, { employeeNo: 'API1', firstName: 'Ana', position: 'Cook' });
		bo = await createTestStaff(A, { employeeNo: 'API2', firstName: 'Bo' });
		cy = await createTestStaff(B, { employeeNo: 'API3', firstName: 'Cy' });
	});
	afterAll(async () => {
		await cleanupTestEstablishments([A, B]);
	});

	it('lists only the people assigned to the key\'s establishment', async () => {
		const list = await assignedToEstablishment(A);
		expect(list.map((p) => p.first_name).sort()).toEqual(['Ana', 'Bo']);
		expect(list.every((p) => p.assigned)).toBe(true);
		expect(list.find((p) => p.first_name === 'Ana')).toMatchObject({ position: 'Cook' });
	});

	it('never exposes pay, birthdate or government IDs', async () => {
		const [p] = await assignedToEstablishment(A);
		expect(Object.keys(p!).sort()).toEqual(
			['assigned', 'department', 'email', 'employee_no', 'first_name', 'last_name', 'person_ref', 'position', 'status'].sort()
		);
	});

	it('reports a linked person as no longer assigned once their assignment ends', async () => {
		const refs = [await ref(ana), await ref(bo)];
		expect((await peopleByRef(A, refs)).every((p) => p.assigned)).toBe(true);

		const { listPeople } = await import('./registry');
		const me = (await listPeople()).find((p) => p.id === ana)!;
		const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
		await endAssignment(me.assignments.find((a) => a.establishmentId === A)!.id, yesterday);

		const after = await peopleByRef(A, refs);
		expect(after.find((p) => p.first_name === 'Ana')).toMatchObject({ assigned: false, position: null });
		expect(after.find((p) => p.first_name === 'Bo')).toMatchObject({ assigned: true });
	});

	it('reports a separated person with their status', async () => {
		await db.update(employees).set({ status: 'separated' }).where(eq(employees.id, bo));
		const [p] = await peopleByRef(A, [await ref(bo)]);
		expect(p).toMatchObject({ status: 'separated' });
	});

	it('tells a soft-deleted person as separated and ignores unknown refs', async () => {
		await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, cy));
		const res = await peopleByRef(B, [await ref(cy), 'per_DOESNOTEXIST']);
		expect(res).toHaveLength(1);
		expect(res[0]).toMatchObject({ status: 'separated' });
	});

	it('moves with an assignment to a second establishment', async () => {
		await assignEmployee({
			employeeId: ana,
			establishmentId: B,
			startDate: '2026-01-01',
			position: 'Head Cook',
			makePrimary: true
		});
		expect((await assignedToEstablishment(B)).some((p) => p.first_name === 'Ana' && p.position === 'Head Cook')).toBe(true);
		expect((await assignedToEstablishment(A)).some((p) => p.first_name === 'Ana')).toBe(false);
	});
});
