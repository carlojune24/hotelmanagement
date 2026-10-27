import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agencyOfRemit, allocate, dueNow, isSecondHalf, monthsAfter, scheduleStatus, scheduledShare } from './loans';
import { buildSchedule, toCsv, type ScheduleLine } from './remittance';
import { cleanupTestEstablishments, cleanupTestOrg, createTestOrg, createTestStaff } from './test-helpers';

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
		expect(agencyOfRemit('sss', 'x')).toBe('sss_loan');
		expect(agencyOfRemit('pagibig', 'x')).toBe('pagibig_loan');
		expect(agencyOfRemit('lender', 'custom_bdo')).toBe('loan:custom_bdo');
		expect(agencyOfRemit('none', 'x')).toBeNull();
	});
});

describe('loan schedule', () => {
	const base = { principal: 120_000, alreadyPaid: 0, amortization: 10_000, startPeriod: '2026-01', thisMonth: '2026-04' };

	it('adds months across a year boundary', () => {
		expect(monthsAfter('2026-11', 2)).toBe('2027-01');
		expect(monthsAfter('2026-01', -1)).toBe('2025-12');
	});

	it('is behind by what the months already due say should have been paid, skipped months excluded', () => {
		// Jan, Mar are due (Feb skipped): 2 × 100 expected, 100 paid.
		const s = scheduleStatus({ ...base, skips: new Set(['2026-02']), paidSince: 10_000 });
		expect(s.behind).toBe(10_000);
		// 1,100 left at 100 a month, from April: April + 10 more = Feb 2027.
		expect(s.expectedEnd).toBe('2027-02');
	});

	it('pushes the end out by a future skipped month and is never behind in the month in progress', () => {
		const s = scheduleStatus({ ...base, startPeriod: '2026-04', skips: new Set(['2026-05']), paidSince: 0 });
		expect(s.behind).toBe(0);
		expect(s.expectedEnd).toBe('2027-04'); // 12 payments, one month skipped
	});

	it('has no end once paid, and starts counting from a future start month', () => {
		expect(scheduleStatus({ ...base, skips: new Set(), paidSince: 120_000 }).expectedEnd).toBeNull();
		const future = scheduleStatus({ ...base, startPeriod: '2026-08', skips: new Set(), paidSince: 0 });
		expect(future).toEqual({ behind: 0, expectedEnd: '2027-07' });
	});

	it('counts what was paid before this system as paid, not as ahead of schedule', () => {
		const s = scheduleStatus({ ...base, alreadyPaid: 60_000, skips: new Set(), paidSince: 0 });
		expect(s.behind).toBe(30_000); // Jan–Mar due, nothing taken since
		expect(s.expectedEnd).toBe('2026-09'); // 600 owed at 100 a month from April
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
	const { dtrEntries, dtrSubmissions, employeeLoanPayments, employeeLoanSkips, employeeLoans, establishments, loanTypes, organizations, payrollRuns, schedules } = await import(
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
	let priorId = '';
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
		org = await createTestOrg(); // own company: the dev DB's real org already has April 2026 payroll
		const o = await db.select({ c: organizations.config }).from(organizations).where(eq(organizations.id, org));
		originalConfig = o[0]!.c;
		await P.saveDayFactor(org, 313);
		await L.listLoanTypes(org); // seeds the default loan types for a fresh company
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
		if (priorId) {
			await db.delete(employeeLoanSkips).where(eq(employeeLoanSkips.loanId, priorId));
			await db.delete(employeeLoanPayments).where(eq(employeeLoanPayments.loanId, priorId));
		}
		await db.delete(employeeLoans).where(eq(employeeLoans.employeeId, ana));
		await db.delete(loanTypes).where(like(loanTypes.key, `custom_emergency_${tag.replace(/-/g, '_')}%`));
		await cleanupTestEstablishments([est]);
		await cleanupTestOrg(org);
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
		// Every loan schedule is listed, even one with nothing on it this month.
		expect(overview.loans.find((a) => a.agency === 'sss_loan')!.people).toBe(1);
		expect(overview.loans.find((a) => a.agency === 'pagibig_loan')!.people).toBe(0);
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

	it('counts what was paid before this system against the balance and what is still due', async () => {
		await expect(
			L.createLoan(org, { employeeId: ana, kind: 'company', principal: 1_000, amortization: 400, alreadyPaid: 1_000, startPeriod: '2026-04' }, null)
		).rejects.toThrow(/whole loan/);
		priorId = (
			await L.createLoan(org, { employeeId: ana, kind: 'company', principal: 1_000, amortization: 400, alreadyPaid: 700, startPeriod: '2026-04' }, null)
		).id;
		const row = (await L.listLoans(org)).find((x) => x.id === priorId)!;
		expect(row.balanceCentavos).toBe(30_000); // ₱1,000 less ₱700 paid before
		expect(row.deductedCentavos).toBe(0); // payroll has taken nothing
		await P.generateBatch(batch2);
		const due = (await deductions(batch2)).loans.find((x) => x.kind === 'company')!;
		expect(due.due).toBe(20_000); // half of ₱400, still under the ₱300 left
	});

	it('skips a chosen pay month, resumes after it, and refuses a month a locked payslip already covers', async () => {
		const may = { id: '00000000-0000-4000-8000-000000000001', organizationId: org, cutoffStart: '2026-05-01', cutoffEnd: '2026-05-15', payDate: '2026-05-20', frequency: 'semi_monthly' };
		const dueIn = async (run: typeof may) => (await L.loansDueFor(run, [ana])).get(ana)?.some((d) => d.loanId === priorId) ?? false;
		expect(await dueIn(may)).toBe(true);

		await expect(L.addSkip(org, { loanId: priorId, payMonth: '2026-04', reason: 'On unpaid leave' }, null)).rejects.toThrow(/locked payslip/);
		await expect(L.addSkip(org, { loanId: priorId, payMonth: '2026-03', reason: 'Too early' }, null)).rejects.toThrow(/not deducted before/);

		const { skip } = await L.addSkip(org, { loanId: priorId, payMonth: '2026-05', reason: 'On unpaid leave' }, null);
		await expect(L.addSkip(org, { loanId: priorId, payMonth: '2026-05', reason: 'Again' }, null)).rejects.toThrow(/already skipped/);
		expect(await dueIn(may)).toBe(false);
		expect(await dueIn({ ...may, cutoffStart: '2026-06-01', cutoffEnd: '2026-06-15', payDate: '2026-06-20' })).toBe(true);
		expect((await L.listSkips(priorId)).map((k) => [k.payMonth, k.locked])).toEqual([['2026-05', false]]);
		expect((await L.upcomingSkips([priorId], '2026-05')).get(priorId)).toEqual(['2026-05']);

		await L.removeSkip(org, skip.id);
		expect(await dueIn(may)).toBe(true);
	});

	it('records a payment received outside payroll, counts it, and closes and reopens the loan with it', async () => {
		await expect(L.addPayment(org, { loanId: priorId, paidOn: '2099-01-01', amount: 100 }, null)).rejects.toThrow(/future/);
		await expect(L.addPayment(org, { loanId: priorId, paidOn: '2026-04-10', amount: 500 }, null)).rejects.toThrow(/more than the balance/);
		const first = await L.addPayment(org, { loanId: priorId, paidOn: '2026-04-10', amount: 150, note: 'Cash' }, null);
		const row = (await L.listLoans(org)).find((x) => x.id === priorId)!;
		expect(row.paidOutsideCentavos).toBe(15_000);
		expect(row.balanceCentavos).toBe(15_000); // ₱1,000 − ₱700 before − ₱150 cash
		await P.generateBatch(batch2);
		expect((await deductions(batch2)).loans.find((x) => x.kind === 'company')!.due).toBe(15_000); // capped by the balance

		const last = await L.addPayment(org, { loanId: priorId, paidOn: '2026-04-11', amount: 150 }, null);
		expect((await L.listLoans(org)).find((x) => x.id === priorId)).toMatchObject({ status: 'paid_off', balanceCentavos: 0 });
		await expect(L.addPayment(org, { loanId: priorId, paidOn: '2026-04-12', amount: 1 }, null)).rejects.toThrow(/closed/);

		expect(L.voidPaymentSchema.safeParse({ paymentId: last.payment.id, reason: 'x' }).success).toBe(false);
		await L.voidPayment(org, { paymentId: last.payment.id, reason: 'Bounced transfer' }, null);
		expect((await L.listLoans(org)).find((x) => x.id === priorId)).toMatchObject({ status: 'active', balanceCentavos: 15_000 });
		await expect(L.voidPayment(org, { paymentId: last.payment.id, reason: 'Again' }, null)).rejects.toThrow(/already voided/);
		expect(first.payment.amountCentavos).toBe(15_000);
	});

	it('lists a skipped government loan on its agency schedule for the month', async () => {
		await L.addSkip(org, { loanId, payMonth: '2026-06', reason: 'On unpaid leave' }, null);
		const sss = await L.skippedLoansFor(org, 'sss_loan', '2026-06');
		expect(sss).toHaveLength(1);
		expect(sss[0]).toMatchObject({ reference: 'L-1', reason: 'On unpaid leave' });
		expect(await L.skippedLoansFor(org, 'pagibig_loan', '2026-06')).toHaveLength(0);
		expect(await L.skippedLoansFor(org, 'sss_loan', '2026-07')).toHaveLength(0);
		const [k] = await L.listSkips(loanId);
		await L.removeSkip(org, k!.id);
	});

	it('lets the loan amount and start month be corrected only until a locked payslip has deducted it', async () => {
		const edited = await L.editLoan(org, {
			loanId: priorId, amortization: 400, alreadyPaid: 700, principal: 1_100, startPeriod: '2026-04', releasedOn: '2026-03-20', termMonths: 6
		});
		expect(edited.after).toMatchObject({ principalCentavos: 110_000, releasedOn: '2026-03-20', termMonths: 6 });
		// The SSS loan was deducted by the locked April batch.
		await expect(L.editLoan(org, { loanId, amortization: 10_000, principal: 12_500 })).rejects.toThrow(/locked payslip already deducted/);
		await expect(L.editLoan(org, { loanId: priorId, amortization: 400, alreadyPaid: 700, startPeriod: '2026-04', principal: 100 })).rejects.toThrow(/more than the loan/);
	});
});
