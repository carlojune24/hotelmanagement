import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';

/**
 * Live-DB tests for the internal HR reports. A throwaway establishment in a far-future month, so real
 * data never mixes in; every figure is checked against the source it must reconcile with.
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

describe('yearsBetween', async () => {
	const { yearsBetween } = await import('./internal-reports');
	it('floors to whole years and never goes negative', () => {
		expect(yearsBetween('1990-06-15', '2031-06-14')).toBe(40);
		expect(yearsBetween('1990-06-15', '2031-06-15')).toBe(41);
		expect(yearsBetween('2031-06-15', '2030-01-01')).toBe(0);
	});
});

describe.skipIf(!hasDb)('internal reports (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { dtrEntries, dtrSubmissions, employees, establishments, payrollRuns, schedules, separations } = await import(
		'$lib/server/db/schema/index'
	);
	const { mintRef } = await import('$lib/server/ids');
	const { eq } = await import('drizzle-orm');
	const P = await import('./payroll');
	const R = await import('./internal-reports');
	const { toCsv } = await import('./csv');

	const tag = `irtest-${Math.random().toString(36).slice(2, 8)}`;
	const FROM = '2031-08-01';
	const TO = '2031-08-31';
	let org = '';
	let est = '';
	let ana = '';
	let bo = '';
	let cy = '';
	const runIds: string[] = [];

	const day = async (emp: string, date: string, o: { worked?: number; late?: number; absent?: boolean } = {}) => {
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
			workedMinutes: o.absent ? 0 : (o.worked ?? 480),
			tardinessMinutes: o.late ?? 0,
			isAbsent: o.absent ?? false,
			source: 'manual'
		});
	};

	beforeAll(async () => {
		org = await testOrgId();
		await P.saveDayFactor(org, 313);
		const [e] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: tag, name: 'IR test', orgRef: mintRef('org') })
			.returning({ id: establishments.id });
		est = e!.id;
		ana = await createTestStaff(est, { employeeNo: 'IR1', firstName: 'Ana' });
		bo = await createTestStaff(est, { employeeNo: 'IR2', firstName: 'Bo' });
		cy = await createTestStaff(est, { employeeNo: 'IR3', firstName: 'Cy' });
		await db.update(employees).set({ employmentType: 'part_time', sex: 'male' }).where(eq(employees.id, bo));

		await day(ana, '2031-08-04');
		await day(ana, '2031-08-05', { late: 15 });
		await day(bo, '2031-08-04', { absent: true });
		await day(cy, '2031-08-19');

		// Cy resigns inside the window.
		await db.update(employees).set({ separatedOn: '2031-08-20', status: 'separated' }).where(eq(employees.id, cy));
		await db.insert(separations).values({ organizationId: org, employeeId: cy, kind: 'resigned', lastDay: '2031-08-20' });

		await db.insert(dtrSubmissions).values({ establishmentId: est, cutoffStart: FROM, cutoffEnd: TO, status: 'received' });
		const run = await P.createRun(org, { cutoffStart: FROM, cutoffEnd: TO, payDate: '2031-09-05', frequency: 'monthly' }, null);
		runIds.push(run.id);
		const batch = (await P.getRun(run.id)).batches.find((x) => x.establishmentId === est)!.id;
		await P.generateBatch(batch);
	});

	afterAll(async () => {
		for (const id of runIds) await db.delete(payrollRuns).where(eq(payrollRuns.id, id));
		await db.delete(separations).where(eq(separations.employeeId, cy));
		await cleanupTestEstablishments([est]);
	});

	it('headcount counts who is employed on the date, once, split full-time / part-time', async () => {
		const h = await R.headcountReport(org, { asOf: '2031-08-10', establishmentId: est });
		expect(h.total).toBe(3);
		expect(h.partTime).toBe(1);
		expect(h.fullTime).toBe(2);
		expect(h.byEstablishment).toEqual([{ name: 'IR test', count: 3 }]);
		// After Cy's last day she is not counted.
		expect((await R.headcountReport(org, { asOf: '2031-08-25', establishmentId: est })).total).toBe(2);
		expect(h.byAge.reduce((a, b) => a + b.count, 0)).toBe(3);
		expect(h.byTenure.reduce((a, b) => a + b.count, 0)).toBe(3);
	});

	it('attendance totals come from the saved DTR rows', async () => {
		const a = await R.attendanceReport(org, { from: FROM, to: TO, establishmentId: est });
		expect(a.rows).toHaveLength(3);
		expect(a.totals).toMatchObject({ daysWorked: 3, absences: 1, lateCount: 1, lateMinutes: 15 });
	});

	it('payroll summary reconciles with the payslip lines and keeps drafts out unless asked', async () => {
		expect((await R.payrollSummary(org, { from: FROM, to: TO, establishmentId: est })).total.payslips).toBe(0);
		const s = await R.payrollSummary(org, { from: FROM, to: TO, establishmentId: est, includeDrafts: true });
		expect(s.total.payslips).toBeGreaterThan(0);
		expect(s.draftLines).toBe(s.total.payslips);
		const e = s.total.earnings;
		// Earnings parts never exceed gross; net is what is left after the employee deductions.
		expect(Object.values(e).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(s.total.gross + 1);
		expect(s.byEstablishment).toHaveLength(1);
		expect(s.byEstablishment[0]!.gross).toBe(s.total.gross);
	});

	it('turnover finds the resignation, calls it voluntary and moves headcount by one', async () => {
		const t = await R.turnoverReport(org, { from: FROM, to: TO });
		const mine = t.people.find((p) => p.lastDay === '2031-08-20' && p.name.startsWith('Test, Cy'));
		expect(mine).toMatchObject({ kind: 'resigned', voluntary: true });
		expect(t.voluntary).toBeGreaterThanOrEqual(1);
		expect(t.headcountStart - t.headcountEnd).toBeGreaterThanOrEqual(1);
		expect(t.turnoverRatePct).not.toBeNull();
	});

	it('every report builds a document whose rows match their headers', async () => {
		const { INTERNAL_REPORTS, buildReportDoc, parseParams } = await import('./report-docs');
		const p = await parseParams(org, new URLSearchParams({ from: FROM, to: TO, asOf: '2031-08-10', fromMonth: '2031-08', toMonth: '2031-08', est, drafts: '1' }), '2031-08-31');
		for (const r of INTERNAL_REPORTS) {
			const doc = await buildReportDoc(r.key, org, p);
			expect(doc.sections.length).toBeGreaterThan(0);
			for (const s of doc.sections) for (const row of s.rows) expect(row).toHaveLength(s.head.length);
		}
	});

	it('csv quotes commas and quotes and starts with a BOM', () => {
		const out = toCsv(['name', 'note'], [['Doe, Jane', 'said "hi"']]);
		expect(out.startsWith('﻿')).toBe(true);
		expect(out).toContain('"Doe, Jane","said ""hi"""');
	});
});
