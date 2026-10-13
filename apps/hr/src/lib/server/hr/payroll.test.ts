import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';

/**
 * Live-DB tests for payroll runs: built only from received DTRs, per establishment, one line per
 * person, locked before it can be released. Throwaway data; the company's day-factor setting is
 * put back afterwards. Skipped without a database.
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

describe.skipIf(!hasDb)('payroll (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { dtrEntries, dtrSubmissions, establishments, organizations, payrollRuns, schedules } =
		await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { eq } = await import('drizzle-orm');
	const P = await import('./payroll');

	const tag = `paytest-${Math.random().toString(36).slice(2, 10)}`;
	let org = '';
	let A = '';
	let B = '';
	let ana = '';
	let bo = ''; // assigned at A, no DTR at all
	let cy = ''; // home A, also worked at B
	let originalConfig: unknown = {};
	let runId = '';
	let batchA = '';
	let batchB = '';

	const mkEst = async (suffix: string) => {
		const [e] = await db
			.insert(establishments)
			.values({
				organizationId: org,
				kind: 'business',
				slug: `${tag}-${suffix}`,
				name: `Payroll test ${suffix}`,
				orgRef: mintRef('org')
			})
			.returning({ id: establishments.id });
		return e!.id;
	};
	const dtr = async (est: string, emp: string, date: string, over: Partial<typeof dtrEntries.$inferInsert> = {}) => {
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
			source: 'manual',
			...over
		});
	};
	const receive = (est: string, month = '2026-03') =>
		db.insert(dtrSubmissions).values({
			establishmentId: est,
			cutoffStart: `${month}-01`,
			cutoffEnd: `${month}-31`,
			status: 'received'
		});

	beforeAll(async () => {
		org = await testOrgId();
		const o = await db.select({ c: organizations.config }).from(organizations).where(eq(organizations.id, org));
		originalConfig = o[0]!.c;
		await P.saveDayFactor(org, 313);

		A = await mkEst('a');
		B = await mkEst('b');
		ana = await createTestStaff(A, { employeeNo: 'PY1', firstName: 'Ana' });
		bo = await createTestStaff(A, { employeeNo: 'PY2', firstName: 'Bo' });
		cy = await createTestStaff(A, { employeeNo: 'PY3', firstName: 'Cy' });
		// Cy is also assigned at B and worked there.
		const { assignEmployee } = await import('./registry');
		await assignEmployee({ employeeId: cy, establishmentId: B, startDate: '2026-01-01', position: 'Barista', makePrimary: false });

		// Ana: 4 full days + 1 absence (scheduled, nothing worked) in the first half of March.
		for (const d of ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']) await dtr(A, ana, d);
		await dtr(A, ana, '2026-03-06', { workedMinutes: 0, timeIn: null, timeOut: null, isAbsent: true });
		// Cy: 2 days at A, 1 day at B.
		await dtr(A, cy, '2026-03-02');
		await dtr(A, cy, '2026-03-03');
		await dtr(B, cy, '2026-03-04');
	});
	afterAll(async () => {
		if (runId) await db.delete(payrollRuns).where(eq(payrollRuns.id, runId));
		await cleanupTestEstablishments([A, B]);
		await db.update(organizations).set({ config: originalConfig as object }).where(eq(organizations.id, org));
	});

	it('refuses to start a run until the working-day factor is chosen', async () => {
		await db.update(organizations).set({ config: {} }).where(eq(organizations.id, org));
		await expect(
			P.createRun(org, { cutoffStart: '2026-03-01', cutoffEnd: '2026-03-15', payDate: '2026-03-20', frequency: 'semi_monthly' }, null)
		).rejects.toThrow(/working-day factor/);
		await P.saveDayFactor(org, 313);
	});

	it('creates a run with one batch per active establishment, and never overlaps a cutoff', async () => {
		const run = await P.createRun(
			org,
			{ cutoffStart: '2026-03-01', cutoffEnd: '2026-03-15', payDate: '2026-03-20', frequency: 'semi_monthly' },
			null
		);
		runId = run.id;
		expect(run.dayFactor).toBe(313);
		const { batches } = await P.getRun(runId);
		batchA = batches.find((b) => b.establishmentId === A)!.id;
		batchB = batches.find((b) => b.establishmentId === B)!.id;
		expect(batchA).toBeTruthy();
		await expect(
			P.createRun(org, { cutoffStart: '2026-03-10', cutoffEnd: '2026-03-20', payDate: '2026-03-25', frequency: 'semi_monthly' }, null)
		).rejects.toThrow(/already covers/);
	});

	it('will not build payroll from a DTR that has not been received', async () => {
		await expect(P.generateBatch(batchA)).rejects.toThrow(/not been received/);
	});

	it('builds one line per person with the right pay once the DTR is received', async () => {
		await receive(A);
		const r = await P.generateBatch(batchA);
		const lines = await P.listBatchLines(batchA);

		const anaLine = lines.find((l) => l.employeeId === ana)!;
		expect(anaLine).toBeDefined();
		// ₱10,000/month → ₱5,000 for the half, less one absent day at 10,000 × 12 ÷ 313.
		const daily = Math.round((1_000_000 * 12) / 313);
		expect((anaLine.earnings as { basic: number }).basic).toBe(500_000 - daily);
		expect(anaLine.netPayCentavos).toBe(
			anaLine.grossCentavos - Object.values(anaLine.deductions as Record<string, number>).reduce((a, b) => a + b, 0)
		);
		expect(anaLine.establishmentId).toBe(A);
		expect(anaLine.employeeName).toBe('Test, Ana');
		// Bo has no DTR at all: reported, not silently paid or zeroed.
		expect(r.noDtr).toEqual(['Test, Bo']);
		expect(lines.some((l) => l.employeeId === bo)).toBe(false);
	});

	it('holds a multi-site person until every establishment they worked at has been received', async () => {
		const lines = await P.listBatchLines(batchA);
		expect(lines.some((l) => l.employeeId === cy)).toBe(false);
		const r = await P.generateBatch(batchA);
		expect(r.waiting).toEqual([{ name: 'Test, Cy', establishments: ['Payroll test b'] }]);
	});

	it('pays them once, under their home, with the cost split by time worked, once B is received', async () => {
		await receive(B);
		await P.generateBatch(batchA);
		const lines = await P.listBatchLines(batchA);
		const cyLine = lines.find((l) => l.employeeId === cy)!;
		expect(cyLine).toBeDefined();
		const cost = cyLine.costByEstablishment as Record<string, number>;
		expect(Object.values(cost).reduce((a, b) => a + b, 0)).toBe(cyLine.grossCentavos);
		expect(cost[B]).toBeGreaterThan(0); // B bears its share
		expect(cost[A]).toBeGreaterThan(cost[B]!); // 2 days vs 1
		// B's own batch holds no line for Cy: one payslip per person.
		await P.generateBatch(batchB);
		expect((await P.listBatchLines(batchB)).length).toBe(0);
	});

	it('charges nothing to an agency the person is not covered by, and freezes why on the line', async () => {
		const { employees } = await import('$lib/server/db/schema/index');
		await db
			.update(employees)
			.set({ sssCovered: false, coverageNote: 'covered through another employer' })
			.where(eq(employees.id, ana));
		await P.generateBatch(batchA);
		const [off] = (await P.listBatchLines(batchA)).filter((l) => l.employeeId === ana);
		expect((off!.deductions as { sss_ee: number }).sss_ee).toBe(0);
		expect((off!.employerContributions as { sss_er: number; ecc: number })).toMatchObject({ sss_er: 0, ecc: 0 });
		expect((off!.deductions as { philhealth_ee: number }).philhealth_ee).toBeGreaterThan(0);
		expect(off!.detail).toMatchObject({ coverage: { sss: false, philhealth: true, note: 'covered through another employer' } });

		await db.update(employees).set({ sssCovered: true, coverageNote: null }).where(eq(employees.id, ana));
		await P.generateBatch(batchA);
		const [on] = (await P.listBatchLines(batchA)).filter((l) => l.employeeId === ana);
		expect((on!.deductions as { sss_ee: number }).sss_ee).toBeGreaterThan(0);
	});

	it('re-prices a line from adjustments and keeps them across a regenerate', async () => {
		const [line] = (await P.listBatchLines(batchA)).filter((l) => l.employeeId === ana);
		const before = line!.netPayCentavos;
		await P.adjustLine({
			lineId: line!.id,
			allowances: 500,
			otherEarnings: 0,
			cashAdvance: 200,
			loans: 0,
			otherDeductions: 0,
			withholdingOverride: null
		});
		const [after] = (await P.listBatchLines(batchA)).filter((l) => l.employeeId === ana);
		expect(after!.grossCentavos).toBe(line!.grossCentavos + 50_000);
		expect((after!.deductions as { cash_advance: number }).cash_advance).toBe(20_000);
		expect(after!.netPayCentavos).toBeGreaterThan(before); // +500 allowance − 200 advance (below the tax line)

		await P.generateBatch(batchA);
		const [again] = (await P.listBatchLines(batchA)).filter((l) => l.employeeId === ana);
		expect((again!.earnings as { allowances: number }).allowances).toBe(50_000);
		expect(again!.netPayCentavos).toBe(after!.netPayCentavos);
	});

	it('cannot lock before the rates are confirmed, nor release before locking', async () => {
		await expect(P.lockBatch(batchA, null)).rejects.toThrow(/Confirm the statutory rates/);
		await expect(P.releaseBatch(batchA, null)).rejects.toThrow(/Lock the batch/);
	});

	it('locks, then refuses changes; unlock reopens; release shows payslips to the establishment', async () => {
		await P.acknowledgeRates(runId, null);
		await P.lockBatch(batchA, null);
		const [line] = (await P.listBatchLines(batchA)).filter((l) => l.employeeId === ana);
		await expect(P.adjustLine({ lineId: line!.id, allowances: 1, otherEarnings: 0, cashAdvance: 0, loans: 0, otherDeductions: 0, withholdingOverride: null })).rejects.toThrow(/locked/);
		await expect(P.generateBatch(batchA)).rejects.toThrow(/locked/);

		await P.unlockBatch(batchA);
		await P.lockBatch(batchA, null);
		expect(await P.releasedPayslipsFor(A)).toEqual([]); // locked is not visible yet
		await P.releaseBatch(batchA, null);
		const slips = await P.releasedPayslipsFor(A);
		expect(slips.map((s) => s.employeeName).sort()).toEqual(['Test, Ana', 'Test, Cy']);
		expect(await P.releasedPayslipsFor(B)).toEqual([]); // listed under the home only
	});

	it('masks government numbers to their last four characters', () => {
		expect(P.maskId('1234567890')).toBe('••••••7890');
		expect(P.maskId('12')).toBe('12');
		expect(P.maskId(null)).toBe('—');
	});
});

