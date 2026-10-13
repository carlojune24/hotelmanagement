import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agencyOfRemit, allocate, dueNow, isSecondHalf, scheduledShare } from './loans';
import { buildSchedule, toCsv, type ScheduleLine } from './remittance';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';

describe('loan rules', () => {
	it('splits a monthly amount across a semi-monthly month, the odd centavo in the second half', () => {
		expect(scheduledShare(100_001, 'semi_monthly', false)).toBe(50_000);
		expect(scheduledShare(100_001, 'semi_monthly', true)).toBe(50_001);
		expect(scheduledShare(100_001, 'monthly', true)).toBe(100_001);
		expect(scheduledShare(100_001, 'semi_monthly', false) + scheduledShare(100_001, 'semi_monthly', true)).toBe(100_001);
	});

	it('knows which half a cutoff is', () => {
		expect(isSecondHalf('2026-04-15')).toBe(false);
		expect(isSecondHalf('2026-04-30')).toBe(true);
		expect(isSecondHalf('2026-04-25')).toBe(true);
	});

	it('carries a shortfall but never asks for more than the balance', () => {
		expect(dueNow({ scheduled: 500, carried: 200, remaining: 10_000 })).toBe(700);
		expect(dueNow({ scheduled: 500, carried: 200, remaining: 300 })).toBe(300);
		expect(dueNow({ scheduled: 500, carried: 0, remaining: 0 })).toBe(0);
	});

	it('fills loans in order from the pay available and never goes negative', () => {
		expect(allocate([500, 300], 600)).toEqual([500, 100]);
		expect(allocate([500, 300], 2_000)).toEqual([500, 300]);
		expect(allocate([500, 300], -50)).toEqual([0, 0]);
	});

	it('routes a loan type to its schedule; "not remitted" goes to none', () => {
		expect(agencyOfRemit('sss')).toBe('sss_loan');
		expect(agencyOfRemit('pagibig')).toBe('pagibig_loan');
		expect(agencyOfRemit('none')).toBeNull();
	});
});

const line = (o: Partial<ScheduleLine> & { employeeId: string }): ScheduleLine => ({
	employeeName: o.employeeId,
	employeeNo: `no-${o.employeeId}`,
	establishmentId: 'est1',
	govIds: { sss: '33-1234567-8', pagibig: '1212-3434-5656' },
	deductions: {},
	employerContributions: {},
	...o
});

describe('loan remittance schedules', () => {
	const lines = [
		line({
			employeeId: 'a',
			loans: [
				{ kind: 'sss_salary', agency: 'sss_loan', referenceNo: 'L-1', deducted: 120_000 },
				{ kind: 'pagibig_mpl', agency: 'pagibig_loan', referenceNo: 'P-9', deducted: 50_000 },
				{ kind: 'company', agency: null, referenceNo: null, deducted: 99_000 }
			]
		}),
		line({ employeeId: 'a', loans: [{ kind: 'sss_salary', agency: 'sss_loan', referenceNo: 'L-1', deducted: 120_000 }] }),
		line({ employeeId: 'b' })
	];

	it('puts only SSS loans on the SSS loan schedule, summed across the month with the reference', () => {
		const s = buildSchedule('sss_loan', lines);
		expect(s.rows).toHaveLength(1);
		expect(s.rows[0]).toMatchObject({ employee: 240_000, employer: 0, total: 240_000, reference: 'L-1', idNumber: '33-1234567-8' });
	});

	it('keeps Pag-IBIG loans apart and never lists a company loan', () => {
		expect(buildSchedule('pagibig_loan', lines).totals.total).toBe(50_000);
		const all = buildSchedule('sss_loan', lines).totals.total + buildSchedule('pagibig_loan', lines).totals.total;
		expect(all).toBe(290_000); // the ₱990 company loan is in neither
	});

	it('exports a loan CSV with the reference and an amount-only total', () => {
		const csv = toCsv(buildSchedule('sss_loan', lines)).trim().split('\r\n');
		expect(csv[0]).toBe('Employee no.,Name,ID number,Loan reference,Amount deducted');
		expect(csv[1]).toBe('no-a,a,33-1234567-8,L-1,2400.00');
		expect(csv.at(-1)).toBe(',TOTAL,,,2400.00');
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

describe.skipIf(!hasDb)('loans through payroll (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { dtrEntries, dtrSubmissions, employeeLoans, establishments, loanTypes, organizations, payrollRuns, schedules } = await import(
		'$lib/server/db/schema/index'
	);
	const { mintRef } = await import('$lib/server/ids');
	const { eq, like } = await import('drizzle-orm');
	const P = await import('./payroll');
	const L = await import('./loans');
	const R = await import('./remittance');

	const tag = `loantest-${Math.random().toString(36).slice(2, 10)}`;
	let org = '';
	let est = '';
	let ana = '';
	let originalConfig: unknown = {};
	const runIds: string[] = [];
	let loanId = '';
	let companyId = '';
	let batch1 = '';
	let batch2 = '';

	const dtr = async (date: string) => {
		const [s] = await db
			.insert(schedules)
			.values({ establishmentId: est, employeeId: ana, date, isRestDay: false, startTime: '08:00', endTime: '17:00', breakMinutes: 60 })
			.returning({ id: schedules.id });
		await db.insert(dtrEntries).values({
			establishmentId: est,
			employeeId: ana,
			scheduleId: s!.id,
			date,
			timeIn: new Date(`${date}T00:00:00Z`),
			timeOut: new Date(`${date}T08:00:00Z`),
			workedMinutes: 480,
			source: 'manual'
		});
	};
	const deductions = async (batchId: string) => {
		const [l] = await P.listBatchLines(batchId);
		return { line: l!, loans: (l!.detail as { loans?: Array<{ kind: string; due: number; deducted: number }> }).loans ?? [] };
	};

	beforeAll(async () => {
		org = await testOrgId();
		const o = await db.select({ c: organizations.config }).from(organizations).where(eq(organizations.id, org));
		originalConfig = o[0]!.c;
		await P.saveDayFactor(org, 313);
		const [e] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: tag, name: 'Loan test', orgRef: mintRef('org') })
			.returning({ id: establishments.id });
		est = e!.id;
		ana = await createTestStaff(est, { employeeNo: 'LN1', firstName: 'Ana' });
		await dtr('2026-04-02');
		await dtr('2026-04-17');
		await db.insert(dtrSubmissions).values({ establishmentId: est, cutoffStart: '2026-04-01', cutoffEnd: '2026-04-30', status: 'received' });
	});
	afterAll(async () => {
		for (const id of runIds) await db.delete(payrollRuns).where(eq(payrollRuns.id, id));
		await db.delete(employeeLoans).where(eq(employeeLoans.employeeId, ana));
		await db.delete(loanTypes).where(like(loanTypes.key, `custom_emergency_${tag.replace(/-/g, '_')}%`));
		await cleanupTestEstablishments([est]);
		await db.update(organizations).set({ config: originalConfig as object }).where(eq(organizations.id, org));
	});

	it('records loans and rejects a monthly amount larger than the loan', async () => {
		await expect(
			L.createLoan(org, { employeeId: ana, kind: 'sss_salary', principal: 100, amortization: 200, startPeriod: '2026-04' }, null)
		).rejects.toThrow(/more than the loan/);
		// ₱10,000 a month on a ₱12,000 loan: more than half-month pay can carry, so the first cutoff falls short.
		loanId = (await L.createLoan(org, { employeeId: ana, kind: 'sss_salary', referenceNo: 'L-1', principal: 12_000, amortization: 10_000, startPeriod: '2026-04' }, null)).id;
		companyId = (await L.createLoan(org, { employeeId: ana, kind: 'company', principal: 1_000, amortization: 400, startPeriod: '2026-04' }, null)).id;
	});

	it('takes what the pay can cover, takes government loans first, and never goes below zero', async () => {
		const run = await P.createRun(org, { cutoffStart: '2026-04-01', cutoffEnd: '2026-04-15', payDate: '2026-04-20', frequency: 'semi_monthly' }, null);
		runIds.push(run.id);
		batch1 = (await P.getRun(run.id)).batches.find((b) => b.establishmentId === est)!.id;
		await P.generateBatch(batch1);
		const { line: l, loans } = await deductions(batch1);
		const sss = loans.find((x) => x.kind === 'sss_salary')!;
		const company = loans.find((x) => x.kind === 'company')!;
		expect(sss.due).toBe(500_000); // half of ₱10,000
		expect(sss.deducted).toBeLessThan(sss.due);
		expect(sss.deducted).toBeGreaterThan(0);
		expect(company.deducted).toBe(0); // nothing left after the government loan
		expect(l.netPayCentavos).toBe(0);
		expect((l.deductions as { loans: number }).loans).toBe(sss.deducted);
		expect((l.adjustments as { loansCentavos: number }).loansCentavos).toBe(0);
	});

	it('counts a draft deduction nowhere until the batch is locked', async () => {
		expect((await L.listLoans(org)).find((x) => x.id === loanId)!.balanceCentavos).toBe(1_200_000);
		expect((await R.getSchedule(org, 'sss_loan', '2026-04')).schedule.rows).toHaveLength(0);
	});

	it('regenerating is stable — it does not stack deductions on itself', async () => {
		const before = (await deductions(batch1)).loans.map((x) => x.deducted);
		await P.generateBatch(batch1);
		expect((await deductions(batch1)).loans.map((x) => x.deducted)).toEqual(before);
	});

	it('cannot be edited by hand: an adjustment keeps the ledger amount, capped by the remaining pay', async () => {
		const { line: l } = await deductions(batch1);
		await P.adjustLine({ lineId: l.id, allowances: 0, otherEarnings: 0, cashAdvance: 0, otherDeductions: 0, withholdingOverride: null });
		const after = (await deductions(batch1)).line;
		expect((after.deductions as { loans: number }).loans).toBe((l.deductions as { loans: number }).loans);
		expect(after.netPayCentavos).toBeGreaterThanOrEqual(0);
	});

	it('shows up on the loan schedule and the balance once locked, and not on the other agency', async () => {
		await P.acknowledgeRates(runIds[0]!, null);
		await P.lockBatch(batch1, null);
		const { loans } = await deductions(batch1);
		const taken = loans.find((x) => x.kind === 'sss_salary')!.deducted;
		expect((await L.listLoans(org)).find((x) => x.id === loanId)!.balanceCentavos).toBe(1_200_000 - taken);
		const sss = await R.getSchedule(org, 'sss_loan', '2026-04');
		expect(sss.schedule.totals.total).toBe(taken);
		expect(sss.schedule.rows[0]!.reference).toBe('L-1');
		expect((await R.getSchedule(org, 'pagibig_loan', '2026-04')).schedule.rows).toHaveLength(0);
		const overview = await R.getOverview(org, '2026-04', '2026-04-30');
		expect(overview.agencies.map((a) => a.agency)).toContain('sss_loan');
		expect(overview.agencies.map((a) => a.agency)).not.toContain('pagibig_loan');
	});

	it('carries the shortfall into the next cutoff, capped at the balance', async () => {
		const first = (await deductions(batch1)).loans.find((x) => x.kind === 'sss_salary')!;
		const run = await P.createRun(org, { cutoffStart: '2026-04-16', cutoffEnd: '2026-04-30', payDate: '2026-04-30', frequency: 'semi_monthly' }, null);
		runIds.push(run.id);
		batch2 = (await P.getRun(run.id)).batches.find((b) => b.establishmentId === est)!.id;
		await P.generateBatch(batch2);
		const second = (await deductions(batch2)).loans.find((x) => x.kind === 'sss_salary')!;
		const carried = first.due - first.deducted;
		expect(second.due).toBe(Math.min(500_000 + carried, 1_200_000 - first.deducted));
	});

	it('refuses to edit a closed loan and requires a reason to close one', async () => {
		await expect(L.setLoanStatus(org, { loanId: companyId, to: 'cancelled' })).rejects.toThrow(/why/);
		await L.setLoanStatus(org, { loanId: companyId, to: 'cancelled', note: 'Waived by the owner' });
		await expect(L.editLoan(org, { loanId: companyId, amortization: 100 })).rejects.toThrow(/closed/);
		// A paused loan takes nothing in the next generate.
		await L.setLoanStatus(org, { loanId, to: 'paused' });
		await P.generateBatch(batch2);
		expect((await deductions(batch2)).loans).toEqual([]);
	});

	it('lets Main HR add a loan type, routes it to a schedule, and retire it', async () => {
		const type = await L.createLoanType(org, { name: `Emergency ${tag}`, remitTo: 'sss' });
		expect(type.key).toMatch(/^custom_emergency_/);
		await expect(L.createLoanType(org, { name: `emergency ${tag}`, remitTo: 'none' })).rejects.toThrow(/already exists/);

		const loan = await L.createLoan(org, { employeeId: ana, kind: type.key, referenceNo: 'E-1', principal: 1_000, amortization: 100, startPeriod: '2026-04' }, null);
		await L.setLoanStatus(org, { loanId: loanId, to: 'active' });
		await P.generateBatch(batch2);
		const due = (await deductions(batch2)).loans.find((x) => x.kind === type.key);
		expect(due).toBeDefined();
		expect(await db.select().from(employeeLoans).where(eq(employeeLoans.id, loan.id))).toHaveLength(1);

		await L.updateLoanType(org, type.id, { name: type.name, remitTo: 'sss', active: false });
		await expect(
			L.createLoan(org, { employeeId: ana, kind: type.key, principal: 500, amortization: 50, startPeriod: '2026-04' }, null)
		).rejects.toThrow(/active loan type/);
		const listed = (await L.listLoanTypes(org)).find((t) => t.key === type.key)!;
		expect(listed).toMatchObject({ active: false, loanCount: 1, remitTo: 'sss' });
	});
});
