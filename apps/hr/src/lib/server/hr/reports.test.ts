import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';

const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());

async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

/** Live DB; a far-future month so it never meets other payroll data. */
describe.skipIf(!hasDb)('cost center report (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { costCenters, dtrEntries, dtrSubmissions, employees, establishments, organizations, payrollRuns, schedules } =
		await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { and, eq, inArray } = await import('drizzle-orm');
	const P = await import('./payroll');
	const R = await import('./reports');

	const tag = `rptest-${Math.random().toString(36).slice(2, 8)}`;
	const code = `R${tag.slice(-4).toUpperCase()}`;
	const MONTH = '2031-08';
	let org = '';
	let est = '';
	let ana = '';
	let bo = '';
	let cy = '';
	const runIds: string[] = [];
	const batches: string[] = [];
	let originalConfig: unknown = {};

	const worked = async (emp: string, date: string) => {
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
	};

	beforeAll(async () => {
		org = await testOrgId();
		const o = await db.select({ c: organizations.config }).from(organizations).where(eq(organizations.id, org));
		originalConfig = o[0]!.c;
		await P.saveDayFactor(org, 313);
		const [e] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: tag, name: 'Report test', orgRef: mintRef('org') })
			.returning({ id: establishments.id });
		est = e!.id;
		await db.insert(costCenters).values({ organizationId: org, code, name: 'Report center' });
		ana = await createTestStaff(est, { employeeNo: 'RP1', firstName: 'Ana' });
		bo = await createTestStaff(est, { employeeNo: 'RP2', firstName: 'Bo' });
		cy = await createTestStaff(est, { employeeNo: 'RP3', firstName: 'Cy' });
		await db.update(employees).set({ costCenter: code }).where(inArray(employees.id, [ana, bo]));
		for (const emp of [ana, bo, cy]) {
			await worked(emp, '2031-08-04');
			await worked(emp, '2031-08-19');
		}
		await db.insert(dtrSubmissions).values({ establishmentId: est, cutoffStart: '2031-08-01', cutoffEnd: '2031-08-31', status: 'received' });
		for (const [a, b, pay] of [
			['2031-08-01', '2031-08-15', '2031-08-20'],
			['2031-08-16', '2031-08-31', '2031-09-05']
		] as const) {
			const run = await P.createRun(org, { cutoffStart: a, cutoffEnd: b, payDate: pay, frequency: 'semi_monthly' }, null);
			runIds.push(run.id);
			const batch = (await P.getRun(run.id)).batches.find((x) => x.establishmentId === est)!.id;
			batches.push(batch);
			await P.generateBatch(batch);
		}
	});

	afterAll(async () => {
		for (const id of runIds) await db.delete(payrollRuns).where(eq(payrollRuns.id, id));
		await cleanupTestEstablishments([est]);
		await db.delete(costCenters).where(and(eq(costCenters.organizationId, org), eq(costCenters.code, code)));
		await db.update(organizations).set({ config: originalConfig as object }).where(eq(organizations.id, org));
	});

	it('lists the month as having payroll', async () => {
		expect(await R.monthsWithPayroll(org)).toContain(MONTH);
	});

	it('counts nothing while every batch is a draft, and shows the lot once drafts are included', async () => {
		const none = await R.costCenterReport(org, { month: MONTH, establishmentId: est });
		expect(none.lines).toBe(0);
		const all = await R.costCenterReport(org, { month: MONTH, establishmentId: est, includeDrafts: true });
		expect(all.lines).toBe(6); // 3 people × 2 cutoffs
		expect(all.draftLines).toBe(6);
	});

	it('sums a person across both cutoffs, groups by cost center and reconciles with the payslips', async () => {
		const r = await R.costCenterReport(org, { month: MONTH, establishmentId: est, includeDrafts: true });
		const mine = r.centers.find((c) => c.code === code)!;
		expect(mine.people).toBe(2);
		expect(mine.persons.map((p) => p.payslips)).toEqual([2, 2]);
		expect(r.centers.find((c) => c.code === null)!.people).toBe(1);

		const allLines = (await Promise.all(batches.map((b) => P.listBatchLines(b)))).flat();
		expect(r.totals.gross).toBe(allLines.reduce((a, l) => a + l.grossCentavos, 0));
		expect(mine.establishments).toEqual([expect.objectContaining({ name: 'Report test', people: 2 })]);
		expect(mine.total).toBe(mine.gross + mine.employer);
	});

	it('counts locked batches without the draft switch, and produces a CSV with a row per person', async () => {
		for (const [i, id] of runIds.entries()) {
			await P.acknowledgeRates(id, null);
			await P.lockBatch(batches[i]!, null);
		}
		const r = await R.costCenterReport(org, { month: MONTH, establishmentId: est });
		expect(r.lines).toBe(6);
		expect(r.draftLines).toBe(0);
		const csv = R.costReportCsv(r).trim().split('\r\n');
		expect(csv[0]).toBe('month,cost_center_code,cost_center,employee_no,employee,establishment,payslips,gross,employer,total');
		expect(csv).toHaveLength(1 + 3);
		expect(csv.filter((l) => l.includes(`"${code}"`))).toHaveLength(2);
	});

	it('works for a 30-day month and February', async () => {
		for (const month of ['2031-02', '2031-04', '2031-12']) {
			const r = await R.costCenterReport(org, { month, establishmentId: est, includeDrafts: true });
			expect(r.lines).toBe(0);
		}
	});

	it('another month is empty', async () => {
		const r = await R.costCenterReport(org, { month: '2031-09', establishmentId: est, includeDrafts: true });
		expect(r.lines).toBe(0);
		expect(r.centers).toEqual([]);
	});
});
