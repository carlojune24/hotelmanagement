import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, cleanupTestOrg, createTestOrg } from './test-helpers';

const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());
async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

describe.skipIf(!hasDb)('leave types are company-wide (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { establishments } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const L = await import('./leave');

	let org = '';
	let a = '';
	let b = '';

	beforeAll(async () => {
		org = await createTestOrg();
		const mk = async (suffix: string) => {
			const [e] = await db
				.insert(establishments)
				.values({
					organizationId: org,
					kind: 'business',
					slug: `lc-${Math.random().toString(36).slice(2, 8)}-${suffix}`,
					name: `Leave company ${suffix}`,
					orgRef: mintRef('org')
				})
				.returning({ id: establishments.id });
			return e!.id;
		};
		a = await mk('a');
		b = await mk('b');
	});
	afterAll(async () => {
		await cleanupTestEstablishments([a, b]);
		await cleanupTestOrg(org);
	});

	it('gives every establishment of the company the same list', async () => {
		const forA = await L.listLeaveTypes(a);
		const forB = await L.listLeaveTypes(b);
		expect(forA.map((t) => t.id)).toEqual(forB.map((t) => t.id));
		expect(forA.length).toBeGreaterThan(0);
	});

	it('a change made once is what both establishments see', async () => {
		const vl = (await L.listLeaveTypes(a)).find((t) => t.code === 'VL')!;
		await L.saveLeaveType(
			a,
			{
				code: 'VL', name: 'Vacation Leave', description: '', paid: true, daysPerYear: 9, dayCount: 'working',
				minServiceMonths: 0, employmentTypes: [], sexRestriction: null, halfDayAllowed: true,
				carryOverDays: 0, cashConvertible: false, requiresDocument: false, active: true
			},
			vl.id
		);
		const seenByB = (await L.listLeaveTypes(b)).find((t) => t.code === 'VL')!;
		expect(seenByB).toMatchObject({ daysPerYear: 9, active: true });
	});

	it('adds a company leave once and refuses a duplicate code', async () => {
		const input = {
			code: 'CL', name: 'Company Leave', description: '', paid: true, daysPerYear: 2, dayCount: 'working' as const,
			minServiceMonths: 0, employmentTypes: [], sexRestriction: null, halfDayAllowed: false,
			carryOverDays: 0, cashConvertible: false, requiresDocument: false, active: true
		};
		await L.saveLeaveType(a, input);
		await expect(L.saveLeaveType(b, input)).rejects.toThrow(/already a leave with the code CL/);
		expect((await L.listLeaveTypes(b)).some((t) => t.code === 'CL')).toBe(true);
	});
});
