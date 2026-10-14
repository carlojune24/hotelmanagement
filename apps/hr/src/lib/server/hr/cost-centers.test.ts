import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';
import { groupByCostCenter } from '$lib/cost-centers-core';

describe('cost center grouping', () => {
	it('groups gross and employer cost by code, keeps Unassigned last, and totals reconcile', () => {
		const rows = groupByCostCenter([
			{ costCenter: { code: 'KT', name: 'Kitchen' }, gross: 1_000_000, employer: 100_000 },
			{ costCenter: null, gross: 500_000, employer: 50_000 },
			{ costCenter: { code: 'FO', name: 'Front office' }, gross: 800_000, employer: 80_000 },
			{ costCenter: { code: 'KT', name: 'Kitchen' }, gross: 200_000, employer: 20_000 }
		]);
		expect(rows.map((r) => r.code)).toEqual(['FO', 'KT', null]);
		expect(rows[1]).toMatchObject({ people: 2, gross: 1_200_000, employer: 120_000, total: 1_320_000 });
		expect(rows[2]).toMatchObject({ name: 'Unassigned', people: 1, total: 550_000 });
		expect(rows.reduce((a, r) => a + r.gross, 0)).toBe(2_500_000);
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

/** Live DB, far-future month so it never meets other payroll data. */
describe.skipIf(!hasDb)('cost centers in payroll (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { costCenters, dtrEntries, dtrSubmissions, employees, establishments, organizations, payrollRuns, schedules } =
		await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { and, eq, inArray } = await import('drizzle-orm');
	const P = await import('./payroll');
	const CC = await import('./cost-centers');

	const tag = `cctest-${Math.random().toString(36).slice(2, 8)}`;
	const codeA = `T${tag.slice(-4).toUpperCase()}A`;
	const codeB = `T${tag.slice(-4).toUpperCase()}B`;
	let org = '';
	let est = '';
	let ana = '';
	let bo = '';
	let cy = '';
	let runId = '';
	let batch = '';
	let originalConfig: unknown = {};

	beforeAll(async () => {
		org = await testOrgId();
		const o = await db.select({ c: organizations.config }).from(organizations).where(eq(organizations.id, org));
		originalConfig = o[0]!.c;
		await P.saveDayFactor(org, 313);
		const [e] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: tag, name: 'Cost center test', orgRef: mintRef('org') })
			.returning({ id: establishments.id });
		est = e!.id;
		ana = await createTestStaff(est, { employeeNo: 'CC1', firstName: 'Ana' });
		bo = await createTestStaff(est, { employeeNo: 'CC2', firstName: 'Bo' });
		cy = await createTestStaff(est, { employeeNo: 'CC3', firstName: 'Cy' });
		for (const emp of [ana, bo, cy]) {
			for (const date of ['2031-06-02', '2031-06-03']) {
				const [s] = await db
					.insert(schedules)
					.values({ establishmentId: est, employeeId: emp, date, isRestDay: false, startTime: '08:00', endTime: '17:00', breakMinutes: 60 })
					.returning({ id: schedules.id });
				await db.insert(dtrEntries).values({
					establishmentId: est,
					employeeId: emp,
					scheduleId: s!.id,
					date,
					timeIn: new Date(`${date}T00:00:00Z`),
					timeOut: new Date(`${date}T08:00:00Z`),
					workedMinutes: 480,
					source: 'manual'
				});
			}
		}
		await db.insert(dtrSubmissions).values({ establishmentId: est, cutoffStart: '2031-06-01', cutoffEnd: '2031-06-30', status: 'received' });
	});

	afterAll(async () => {
		if (runId) await db.delete(payrollRuns).where(eq(payrollRuns.id, runId));
		await cleanupTestEstablishments([est]);
		await db.delete(costCenters).where(and(eq(costCenters.organizationId, org), inArray(costCenters.code, [codeA, codeB, `${codeA}X`])));
		await db.update(organizations).set({ config: originalConfig as object }).where(eq(organizations.id, org));
	});

	it('adds cost centers, rejects a duplicate code and a malformed one', async () => {
		await CC.saveCostCenter(org, CC.costCenterSchema.parse({ code: codeA, name: 'Front office' }));
		await CC.saveCostCenter(org, CC.costCenterSchema.parse({ code: codeB, name: 'Kitchen' }));
		await expect(CC.saveCostCenter(org, CC.costCenterSchema.parse({ code: codeA, name: 'Again' }))).rejects.toThrow(/already used/);
		expect(CC.costCenterSchema.safeParse({ code: 'has space', name: 'x' }).success).toBe(false);
	});

	it('only accepts a code that is on the list, and refuses an inactive one for a new assignment', async () => {
		await expect(CC.assertCostCenter(org, 'NOPE')).rejects.toThrow(/not on the cost center list/);
		await CC.assertCostCenter(org, codeA); // fine
		await CC.assertCostCenter(org, ''); // none is fine
		const b = (await CC.listCostCenters(org)).find((c) => c.code === codeB)!;
		await CC.setCostCenterActive(org, b.id, false);
		await expect(CC.assertCostCenter(org, codeB)).rejects.toThrow(/inactive/);
		await CC.assertCostCenter(org, codeB, codeB); // already theirs: allowed
		await CC.setCostCenterActive(org, b.id, true);
	});

	it('payroll freezes the code and name on each line and the grouping reconciles with the batch', async () => {
		await db.update(employees).set({ costCenter: codeA }).where(inArray(employees.id, [ana, bo]));
		// Cy has none.
		const run = await P.createRun(org, { cutoffStart: '2031-06-01', cutoffEnd: '2031-06-15', payDate: '2031-06-20', frequency: 'semi_monthly' }, null);
		runId = run.id;
		batch = (await P.getRun(runId)).batches.find((b) => b.establishmentId === est)!.id;
		await P.generateBatch(batch);
		const lines = await P.listBatchLines(batch);
		expect(lines).toHaveLength(3);
		const of = (id: string) => lines.find((l) => l.employeeId === id)!;
		expect((of(ana).detail as { costCenter?: { code: string; name: string } }).costCenter).toEqual({ code: codeA, name: 'Front office' });
		expect((of(cy).detail as { costCenter?: unknown }).costCenter).toBeUndefined();

		const rows = groupByCostCenter(
			lines.map((l) => ({
				costCenter: (l.detail as { costCenter?: { code: string; name: string } }).costCenter ?? null,
				gross: l.grossCentavos,
				employer: Object.values(l.employerContributions as Record<string, number>).reduce((a, b) => a + b, 0)
			}))
		);
		expect(rows.map((r) => r.code)).toEqual([codeA, null]);
		expect(rows[0]!.people).toBe(2);
		expect(rows[1]!.name).toBe('Unassigned');
		expect(rows.reduce((a, r) => a + r.gross, 0)).toBe(lines.reduce((a, l) => a + l.grossCentavos, 0));
	});

	it('renaming a code moves its employees; an already built payslip keeps the old code', async () => {
		const a = (await CC.listCostCenters(org)).find((c) => c.code === codeA)!;
		await CC.saveCostCenter(org, CC.costCenterSchema.parse({ id: a.id, code: `${codeA}X`, name: 'Front desk' }));
		const [emp] = await db.select({ cc: employees.costCenter }).from(employees).where(eq(employees.id, ana));
		expect(emp!.cc).toBe(`${codeA}X`);
		const line = (await P.listBatchLines(batch)).find((l) => l.employeeId === ana)!;
		expect((line.detail as { costCenter: { code: string } }).costCenter.code).toBe(codeA);
		// Regenerating picks the new code up.
		await P.generateBatch(batch);
		const again = (await P.listBatchLines(batch)).find((l) => l.employeeId === ana)!;
		expect(again.detail as { costCenter: { code: string; name: string } }).toMatchObject({
			costCenter: { code: `${codeA}X`, name: 'Front desk' }
		});
	});
});
