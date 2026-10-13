import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';

/**
 * Live-DB tests for the company-wide registry: one person, several establishments. Creates two
 * throwaway establishments and people, and removes only what it created. Skipped without a DB.
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

describe.skipIf(!hasDb)('company registry and assignments (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { establishments } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { listEmployees, getEmployee, archiveEmployee } = await import('./employees');
	const { RegistryError, assignEmployee, endAssignment, listPeople, setPrimary } = await import('./registry');
	const { ScheduleError, applyShiftToCells } = await import('./schedules');
	const { storePunches } = await import('./dtr-import');

	const tag = `regtest-${Math.random().toString(36).slice(2, 10)}`;
	let A = '';
	let B = '';
	let ana = ''; // home A, later also at B
	let bo = ''; // only at A, shares a device ID value with nobody

	const mkEst = async (suffix: string) => {
		const [e] = await db
			.insert(establishments)
			.values({
				organizationId: await testOrgId(),
				kind: 'business',
				slug: `${tag}-${suffix}`,
				name: `Registry test ${suffix}`,
				orgRef: mintRef('org')
			})
			.returning({ id: establishments.id });
		return e!.id;
	};
	const SHIFT = { isRestDay: false, startTime: '08:00', endTime: '17:00', breakMinutes: 60 };
	const today = new Date().toISOString().slice(0, 10);
	// "Last day worked" is inclusive, so ending an assignment *yesterday* removes the person today.
	const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

	beforeAll(async () => {
		A = await mkEst('a');
		B = await mkEst('b');
		ana = await createTestStaff(A, { employeeNo: 'RA', firstName: 'Ana', enrollId: '501', position: 'Cook' });
		bo = await createTestStaff(A, { employeeNo: 'RB', firstName: 'Bo', enrollId: '502' });
	});
	afterAll(async () => {
		await cleanupTestEstablishments([A, B]);
	});

	it('shows a person only where they are assigned', async () => {
		expect((await listEmployees(A)).map((e) => e.id).sort()).toEqual([ana, bo].sort());
		expect(await listEmployees(B)).toEqual([]);
		expect(await getEmployee(B, ana)).toBeNull();
	});

	it('cannot be rostered at an establishment they are not assigned to', async () => {
		await expect(applyShiftToCells(B, [{ employeeId: ana, date: '2026-03-02' }], SHIFT)).rejects.toThrow(ScheduleError);
	});

	it('assigns the same person to a second establishment with its own post and device ID', async () => {
		await assignEmployee({
			employeeId: ana,
			establishmentId: B,
			startDate: '2026-01-01',
			position: 'Head Cook',
			department: 'Kitchen',
			biometricEnrollId: '9001',
			makePrimary: false
		});
		const atB = await listEmployees(B);
		expect(atB).toHaveLength(1);
		expect(atB[0]).toMatchObject({ id: ana, position: 'Head Cook', biometricEnrollId: '9001', isPrimary: false });
		// ...and at A she keeps her own post and device ID.
		const atA = (await listEmployees(A)).find((e) => e.id === ana)!;
		expect(atA).toMatchObject({ position: 'Cook', biometricEnrollId: '501', isPrimary: true });
	});

	it('can now be rostered at the second establishment', async () => {
		await expect(applyShiftToCells(B, [{ employeeId: ana, date: '2026-03-02' }], SHIFT)).resolves.toBeDefined();
	});

	it('refuses a second open assignment at the same establishment', async () => {
		await expect(
			assignEmployee({ employeeId: ana, establishmentId: B, startDate: today, position: 'X', makePrimary: false })
		).rejects.toThrow(RegistryError);
	});

	it('keeps device IDs unique per establishment, not company-wide', async () => {
		// 9001 is Ana's at B — another person at B may not take it...
		const cy = await createTestStaff(B, { employeeNo: 'RC', firstName: 'Cy', enrollId: null });
		await expect(
			assignEmployee({ employeeId: bo, establishmentId: B, startDate: today, position: 'Y', biometricEnrollId: '9001', makePrimary: false })
		).rejects.toThrow(/already used/);
		// ...but "501" (Ana's at A) is free at B.
		await expect(
			assignEmployee({ employeeId: bo, establishmentId: B, startDate: today, position: 'Y', biometricEnrollId: '501', makePrimary: false })
		).resolves.toBeDefined();
		expect(cy).toBeTruthy();
	});

	it('matches punches at B by B\'s device ID, not A\'s', async () => {
		const MAP = { idColumn: 0, datetimeColumn: 1, hasHeader: false, dateFormat: 'ymd' as const };
		const res = await storePunches(
			B,
			[
				['9001', '2026-03-02 07:58:00'],
				['9001', '2026-03-02 17:01:00']
			],
			MAP,
			'b.txt',
			'2026-03',
			null
		);
		expect(res.inserted).toBe(2);
		expect(res.unmatched).toEqual([]); // 9001 is a known device ID at B

		// The same ID at A means nothing: nobody there has 9001.
		const atA = await storePunches(A, [['9001', '2026-03-03 08:00:00']], MAP, 'a.txt', '2026-03', null);
		expect(atA.unmatched.map((u) => u.enrollId)).toEqual(['9001']);
	});

	it('moves "home" and promotes the oldest open assignment when home ends', async () => {
		await setPrimary((await listPeople()).find((p) => p.id === ana)!.assignments.find((a) => a.establishmentId === B)!.id);
		let me = (await listPeople()).find((p) => p.id === ana)!;
		expect(me.assignments.find((a) => a.isPrimary)!.establishmentId).toBe(B);
		expect(me.assignments.filter((a) => a.isPrimary)).toHaveLength(1);

		await endAssignment(me.assignments.find((a) => a.establishmentId === B)!.id, yesterday);
		me = (await listPeople()).find((p) => p.id === ana)!;
		expect(me.assignments).toHaveLength(1);
		expect(me.assignments[0]).toMatchObject({ establishmentId: A, isPrimary: true });
		expect((await listEmployees(B)).some((e) => e.id === ana)).toBe(false);
	});

	it('rejects ending before the assignment started', async () => {
		const me = (await listPeople()).find((p) => p.id === bo)!;
		const a = me.assignments.find((x) => x.establishmentId === A)!;
		await expect(endAssignment(a.id, '1999-01-01')).rejects.toThrow(RegistryError);
	});

	it('archiving at one establishment ends only that assignment and keeps the person', async () => {
		await archiveEmployee(A, bo);
		expect((await listEmployees(A)).some((e) => e.id === bo)).toBe(false);
		const stillThere = (await listPeople()).find((p) => p.id === bo);
		expect(stillThere).toBeDefined(); // still registered company-wide
		expect(stillThere!.assignments.some((a) => a.establishmentId === B)).toBe(true); // B assignment untouched
	});
});
