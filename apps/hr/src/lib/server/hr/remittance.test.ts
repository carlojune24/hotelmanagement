import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	agencyLabel,
	agencySchema,
	buildSchedule,
	dueDateFor,
	dueDayOf,
	isLoanAgency,
	isRemittable,
	toCsv,
	type ScheduleLine
} from './remittance';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';

const line = (o: Partial<ScheduleLine> & { employeeId: string }): ScheduleLine => ({
	employeeName: o.employeeId,
	employeeNo: `no-${o.employeeId}`,
	establishmentId: 'est1',
	govIds: { sss: '33-1234567-8', tin: '111-222-333' },
	deductions: { sss_ee: 100_000, philhealth_ee: 50_000, pagibig_ee: 10_000, withholding_tax: 20_000 },
	employerContributions: { sss_er: 200_000, philhealth_er: 50_000, pagibig_er: 10_000, ecc: 3_000 },
	...o
});

describe('buildSchedule', () => {
	it('sums a person across the month\'s runs and keeps the agency columns apart', () => {
		const s = buildSchedule('sss', [line({ employeeId: 'a' }), line({ employeeId: 'a' }), line({ employeeId: 'b', establishmentId: 'est2' })]);
		expect(s.rows).toHaveLength(2);
		const a = s.rows.find((r) => r.employeeId === 'a')!;
		expect(a).toMatchObject({ employee: 200_000, employer: 400_000, ec: 6_000, total: 606_000 });
		expect(s.totals.total).toBe(606_000 + 303_000);
		expect(s.byEstablishment.est1!.total).toBe(606_000);
		expect(s.byEstablishment.est2!.total).toBe(303_000);
	});

	it('BIR nets off tax returned to employees at year-end, and says how much', () => {
		const s = buildSchedule('bir', [
			line({ employeeId: 'a' }),
			line({ employeeId: 'b', deductions: { withholding_tax: 2_618_40 }, taxReturned: 37_198_40 })
		]);
		expect(s.taxReturned).toBe(37_198_40);
		expect(s.rows.find((r) => r.employeeId === 'b')!.employee).toBe(2_618_40 - 37_198_40);
		expect(s.totals.total).toBe(20_000 + 2_618_40 - 37_198_40);
		// Other agencies are untouched by it.
		expect(buildSchedule('sss', [line({ employeeId: 'b', taxReturned: 37_198_40 })]).taxReturned).toBe(0);
	});

	it('BIR is only the withholding tax, filed under the TIN', () => {
		const s = buildSchedule('bir', [line({ employeeId: 'a' })]);
		expect(s.rows[0]).toMatchObject({ employee: 20_000, employer: 0, total: 20_000, idNumber: '111-222-333' });
	});

	it('flags missing ID numbers and lists people left out as not covered', () => {
		const s = buildSchedule('philhealth', [
			line({ employeeId: 'noid', govIds: {} }),
			line({
				employeeId: 'mwe',
				deductions: { philhealth_ee: 0 },
				employerContributions: { philhealth_er: 0 },
				coverage: { philhealth: false, note: 'covered elsewhere' }
			})
		]);
		expect(s.missingId).toEqual(['noid']);
		expect(s.rows.map((r) => r.employeeId)).toEqual(['noid']);
		expect(s.notCovered).toEqual([{ name: 'mwe', note: 'covered elsewhere' }]);
	});
});

describe('loan schedules per loan type', () => {
	const loans = [
		{ kind: 'custom_bdo', agency: 'loan:custom_bdo', referenceNo: 'B-1', deducted: 150_000 },
		{ kind: 'custom_coop', agency: 'loan:custom_coop', referenceNo: 'C-9', deducted: 40_000 },
		{ kind: 'company', agency: null, referenceNo: null, deducted: 25_000 }
	];
	it('puts each lender on its own schedule, with no government ID and no missing-ID warning', () => {
		const lines = [line({ employeeId: 'a', loans }), line({ employeeId: 'b', loans: [loans[1]!] })];
		const bdo = buildSchedule('loan:custom_bdo', lines);
		expect(bdo.totals.total).toBe(150_000);
		expect(bdo.rows).toHaveLength(1);
		expect(bdo.rows[0]).toMatchObject({ reference: 'B-1', idNumber: null });
		expect(bdo.missingId).toEqual([]);
		expect(buildSchedule('loan:custom_coop', lines).totals.total).toBe(80_000);
	});
	it('shows a company-side loan on its own list, matched by loan type', () => {
		const s = buildSchedule('kept:company', [line({ employeeId: 'a', loans })]);
		expect(s.totals.total).toBe(25_000);
		expect(buildSchedule('sss_loan', [line({ employeeId: 'a', loans })]).rows).toHaveLength(0);
	});
	it('is empty, not absent, for a lender with nothing this month', () => {
		const s = buildSchedule('loan:custom_bdo', [line({ employeeId: 'a' })]);
		expect(s.rows).toHaveLength(0);
		expect(s.totals.total).toBe(0);
	});
	it('names, routes and deadlines', () => {
		expect(agencyLabel('loan:custom_bdo', new Map([['custom_bdo', 'BDO personal loan']]))).toBe('BDO personal loan');
		expect(agencyLabel('sss')).toBe('SSS');
		expect(isLoanAgency('loan:x')).toBe(true);
		expect(isRemittable('kept:x')).toBe(false);
		expect(isRemittable('loan:x')).toBe(true);
		expect(agencySchema.safeParse('loan:custom_bdo').success).toBe(true);
		expect(agencySchema.safeParse('kept:company').success).toBe(false);
		expect(agencySchema.safeParse('nonsense').success).toBe(false);
		const settings = { dueDay: { sss: 10, loans: { custom_bdo: 20 } } };
		expect(dueDayOf(settings, 'loan:custom_bdo')).toBe(20);
		expect(dueDayOf(settings, 'sss')).toBe(10);
		expect(dueDayOf(settings, 'kept:company')).toBeNull();
	});
});

describe('dueDateFor', () => {
	it('is the Nth day of the next month, clamped to its length', () => {
		expect(dueDateFor('2026-03', 10)).toBe('2026-04-10');
		expect(dueDateFor('2026-12', 15)).toBe('2027-01-15');
		expect(dueDateFor('2026-01', 31)).toBe('2026-02-28');
	});
	it('is nothing when no deadline is configured', () => {
		expect(dueDateFor('2026-03', null)).toBeNull();
		expect(dueDateFor('2026-03', undefined)).toBeNull();
	});
});

describe('toCsv', () => {
	it('quotes names with commas and ends with a total row', () => {
		const s = buildSchedule('sss', [line({ employeeId: 'a', employeeName: 'Cruz, Ana' })]);
		const csv = toCsv(s).trim().split('\r\n');
		expect(csv[1]).toContain('"Cruz, Ana"');
		expect(csv.at(-1)).toMatch(/^,TOTAL,,/);
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

describe.skipIf(!hasDb)('remittance (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { establishments, payrollBatches, payrollRunLines, payrollRuns, remittances } = await import(
		'$lib/server/db/schema/index'
	);
	const { mintRef } = await import('$lib/server/ids');
	const { eq } = await import('drizzle-orm');
	const R = await import('./remittance');
	const { unlockBatch, PayrollError } = await import('./payroll');

	const tag = `remit-${Math.random().toString(36).slice(2, 10)}`;
	const PERIOD = '2099-05';
	let org = '';
	let est = '';
	let emp = '';
	let runId = '';
	let batchId = '';

	beforeAll(async () => {
		org = await testOrgId();
		const [e] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: tag, name: 'Remit test', orgRef: mintRef('org') })
			.returning({ id: establishments.id });
		est = e!.id;
		emp = await createTestStaff(est, { employeeNo: 'R1', firstName: 'Rita' });
		const [run] = await db
			.insert(payrollRuns)
			.values({ organizationId: org, cutoffStart: '2099-05-01', cutoffEnd: '2099-05-15', payDate: '2099-05-20', frequency: 'semi_monthly', dayFactor: 313 })
			.returning({ id: payrollRuns.id });
		runId = run!.id;
		const [b] = await db
			.insert(payrollBatches)
			.values({ runId, establishmentId: est, status: 'locked', generatedAt: new Date() })
			.returning({ id: payrollBatches.id });
		batchId = b!.id;
		await db.insert(payrollRunLines).values({
			runId,
			batchId,
			employeeId: emp,
			establishmentId: est,
			personRef: mintRef('person'),
			employeeNo: 'R1',
			employeeName: 'Test, Rita',
			position: 'Tester',
			payBasis: 'monthly',
			baseRateCentavos: 1_000_000,
			govIds: { sss: '33-1' },
			earnings: {},
			grossCentavos: 500_000,
			deductions: { sss_ee: 25_000, philhealth_ee: 12_500, pagibig_ee: 10_000, withholding_tax: 0 },
			employerContributions: { sss_er: 50_000, philhealth_er: 12_500, pagibig_er: 10_000, ecc: 1_000 },
			netPayCentavos: 452_500
		});
	});

	afterAll(async () => {
		await db.delete(remittances).where(eq(remittances.period, PERIOD));
		await db.delete(payrollRuns).where(eq(payrollRuns.id, runId));
		await cleanupTestEstablishments([est]);
	});

	it('reads a locked month and totals the SSS schedule', async () => {
		const s = await R.getSchedule(org, 'sss', PERIOD);
		expect(s.schedule.totals).toMatchObject({ employee: 25_000, employer: 50_000, ec: 1_000, total: 76_000 });
		expect(s.draftBatches).toBe(0);
	});

	it('does not count a draft batch, and refuses to mark an incomplete month remitted', async () => {
		await db.update(payrollBatches).set({ status: 'draft' }).where(eq(payrollBatches.id, batchId));
		const s = await R.getSchedule(org, 'sss', PERIOD);
		expect(s.schedule.rows).toHaveLength(0);
		expect(s.draftBatches).toBe(1);
		await expect(
			R.markRemitted(org, 'sss', PERIOD, { remittedOn: '2099-06-05', referenceNo: 'X' }, null)
		).rejects.toThrow(/not locked/);
		await db.update(payrollBatches).set({ status: 'locked' }).where(eq(payrollBatches.id, batchId));
	});

	it('marking remitted snapshots the amount and stops the batch being unlocked', async () => {
		const row = await R.markRemitted(org, 'sss', PERIOD, { remittedOn: '2099-06-05', referenceNo: 'REF-1' }, null);
		expect(row).toMatchObject({ status: 'remitted', amountCentavos: 76_000, lineCount: 1 });
		await expect(unlockBatch(batchId)).rejects.toThrow(PayrollError);
		await expect(unlockBatch(batchId)).rejects.toThrow(/remittance is already marked as paid/);
		await expect(
			R.markRemitted(org, 'sss', PERIOD, { remittedOn: '2099-06-06', referenceNo: 'REF-2' }, null)
		).rejects.toThrow(/Already/);
	});

	it('reopening frees the batch again', async () => {
		await R.reopenRemittance(org, 'sss', PERIOD);
		const unlocked = await unlockBatch(batchId);
		expect(unlocked.status).toBe('draft');
	});
});
