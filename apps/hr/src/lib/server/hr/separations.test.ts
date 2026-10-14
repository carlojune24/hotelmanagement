import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeTotals } from './separations';
import { amountFor, inclusiveDays } from './thirteenth-month';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';

describe('final pay arithmetic', () => {
	const base = { credits: 0, charges: 0, receipts: 0, writeoffs: 0, loanApplied: 0, loanOwed: 0 };

	it('pays the employee what is left after charges and loan settlements', () => {
		const t = computeTotals({ ...base, credits: 60_000, charges: 10_000, loanApplied: 30_000 });
		expect(t.payToEmployee).toBe(20_000);
		expect(t.nonLoanOwed).toBe(0);
		expect(t.stillOwed).toBe(0);
	});

	it('owes the company what the final pay could not cover, less receipts and write-offs', () => {
		const t = computeTotals({ ...base, credits: 10_000, charges: 40_000, receipts: 5_000, writeoffs: 10_000 });
		expect(t.payToEmployee).toBe(0);
		expect(t.nonLoanOwed).toBe(15_000);
		expect(computeTotals({ ...base, credits: 10_000, charges: 40_000, receipts: 99_000 }).nonLoanOwed).toBe(0);
	});

	it('keeps open loan balances in what is still owed', () => {
		const t = computeTotals({ ...base, credits: 0, charges: 0, loanOwed: 50_000 });
		expect(t.stillOwed).toBe(50_000);
		expect(t.payToEmployee).toBe(0);
	});
});

describe('13th month pay (PD 851)', () => {
	it('is one twelfth of basic earned, less late and undertime, rounded to the centavo', () => {
		expect(amountFor({ basicEarned: 2_000_000, lateDeductions: 10_000 })).toBe(165_833);
		expect(amountFor({ basicEarned: 100, lateDeductions: 500 })).toBe(0);
	});

	it('counts service days inclusively', () => {
		expect(inclusiveDays('2026-01-01', '2026-01-30')).toBe(30);
		expect(inclusiveDays('2026-04-20', '2026-04-30')).toBe(11);
		expect(inclusiveDays('2026-05-01', '2026-04-30')).toBe(0);
	});
});

async function hasDb() {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}
const live = await hasDb();

describe.skipIf(!live)('separations (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { employeeAssignments, employeeLoanPayments, employeeLoans, employees, establishments, separationClearance, separationItems, separations } =
		await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { eq, inArray } = await import('drizzle-orm');
	const S = await import('./separations');
	const L = await import('./loans');

	const tag = `septest-${Math.random().toString(36).slice(2, 10)}`;
	let org = '';
	let est = '';
	let emp = '';
	let loanId = '';
	let sepId = '';

	beforeAll(async () => {
		org = await testOrgId();
		const [e] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: tag, name: 'Separation test', orgRef: mintRef('org') })
			.returning({ id: establishments.id });
		est = e!.id;
		emp = await createTestStaff(est, { employeeNo: 'SP1', firstName: 'Sep' });
		loanId = (
			await L.createLoan(org, { employeeId: emp, kind: 'company', principal: 1_000, amortization: 100, startPeriod: '2026-01' }, null)
		).id;
	});
	afterAll(async () => {
		if (sepId) {
			await db.delete(employeeLoanPayments).where(eq(employeeLoanPayments.loanId, loanId));
			await db.delete(separationItems).where(eq(separationItems.separationId, sepId));
			await db.delete(separationClearance).where(eq(separationClearance.separationId, sepId));
			await db.delete(separations).where(eq(separations.id, sepId));
		} else if (loanId) {
			await db.delete(employeeLoanPayments).where(eq(employeeLoanPayments.loanId, loanId));
		}
		if (loanId) await db.delete(employeeLoans).where(inArray(employeeLoans.id, [loanId]));
		await cleanupTestEstablishments([est]);
	});

	const view = () => S.getSeparation(org, sepId);

	it('starts a separation: ends their assignments, marks them separated, seeds the checklist, only once', async () => {
		const sep = await S.startSeparation(org, { employeeId: emp, kind: 'resigned', lastDay: '2026-09-30', note: 'Moving abroad' }, null);
		sepId = sep.id;
		const [person] = await db.select().from(employees).where(eq(employees.id, emp));
		expect(person).toMatchObject({ status: 'separated', separatedOn: '2026-09-30' });
		const [a] = await db.select().from(employeeAssignments).where(eq(employeeAssignments.employeeId, emp));
		expect(a!.endDate).toBe('2026-09-30');
		expect((await view()).clearance).toHaveLength(S.DEFAULT_CLEARANCE.length);
		await expect(S.startSeparation(org, { employeeId: emp, kind: 'resigned', lastDay: '2026-09-30' }, null)).rejects.toThrow(/already has a separation/);
	});

	it('applies final pay to a loan, capped by what is left after charges, and counts it as a payment', async () => {
		await S.addItem(org, { separationId: sepId, kind: 'credit', label: 'Prorated 13th month', amount: 600 });
		await S.addItem(org, { separationId: sepId, kind: 'charge', label: 'Uniform', amount: 100 });
		expect((await view()).totals.payToEmployee).toBe(50_000);

		await expect(S.applyToLoan(org, { separationId: sepId, loanId, amount: 500.01 }, null)).rejects.toThrow(/more than the final pay/);
		await S.applyToLoan(org, { separationId: sepId, loanId, amount: 500 }, null);
		const v = await view();
		expect(v.totals).toMatchObject({ payToEmployee: 0, loanApplied: 50_000, loanOwed: 50_000, stillOwed: 50_000 });
		expect(v.applied).toHaveLength(1);
		expect((await L.listLoans(org)).find((l) => l.id === loanId)).toMatchObject({ balanceCentavos: 50_000, paidOutsideCentavos: 50_000 });
		await expect(S.applyToLoan(org, { separationId: sepId, loanId, amount: 1 }, null)).rejects.toThrow(/no final pay left/);
	});

	it('will not void pay that loan settlements were taken from', async () => {
		const credit = (await view()).items.find((i) => i.kind === 'credit')!;
		await expect(S.voidItem(org, credit.id, 'Entered twice')).rejects.toThrow(/Undo them first/);
	});

	it('tracks what the employee still owes until it is received or written off', async () => {
		await expect(S.addItem(org, { separationId: sepId, kind: 'receipt', label: 'Cash', amount: 10 })).rejects.toThrow(/Nothing is owed besides loans/);
		await S.addItem(org, { separationId: sepId, kind: 'charge', label: 'Lost key', amount: 300 });
		expect((await view()).totals.nonLoanOwed).toBe(30_000);
		await expect(S.addItem(org, { separationId: sepId, kind: 'receipt', label: 'Cash', amount: 301 })).rejects.toThrow(/more than/);
		await S.addItem(org, { separationId: sepId, kind: 'receipt', label: 'Cash on the last day', amount: 100 });
		await S.addItem(org, { separationId: sepId, kind: 'writeoff', label: 'Waived by the owner', amount: 200 });
		expect((await view()).totals.nonLoanOwed).toBe(0);
	});

	it('refuses to clear while a loan is open, the checklist is unfinished, or final pay is unpaid', async () => {
		await expect(S.clearSeparation(org, sepId, null)).rejects.toThrow(/settle or write off what is still owed/);
		// Clear the loan balance with a direct payment.
		await L.addPayment(org, { loanId, paidOn: '2026-10-01', amount: 500 }, null);
		expect((await view()).totals.stillOwed).toBe(0);
		await expect(S.clearSeparation(org, sepId, null)).rejects.toThrow(/finish the clearance checklist/);
		for (const c of (await view()).clearance) await S.toggleClearance(org, c.id, true, null);
		expect((await view()).canClear).toBe(true);
		await S.clearSeparation(org, sepId, null);
		expect((await view()).sep.status).toBe('cleared');
		await expect(S.addItem(org, { separationId: sepId, kind: 'credit', label: 'Late', amount: 1 })).rejects.toThrow(/already cleared/);
	});

	it('lists the person with their progress', async () => {
		const row = (await S.listSeparations(org)).find((r) => r.id === sepId)!;
		expect(row).toMatchObject({ status: 'cleared', stillOwed: 0, stepsDone: 3, stepsTotal: 3 });
	});
});

describe.skipIf(!live)('13th month from payslips (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { employees, establishments, payrollBatches, payrollRunLines, payrollRuns, separationClearance, separationItems, separations } =
		await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { eq, inArray } = await import('drizzle-orm');
	const T = await import('./thirteenth-month');
	const S = await import('./separations');

	const tag = `thtest-${Math.random().toString(36).slice(2, 10)}`;
	let org = '';
	let est = '';
	let emp = '';
	const runIds: string[] = [];
	let sepId = '';

	const slip = async (cutoffEnd: string, status: string, basic: number, late: number) => {
		const month = cutoffEnd.slice(0, 7);
		const [run] = await db
			.insert(payrollRuns)
			.values({
				organizationId: org,
				cutoffStart: `${month}-${cutoffEnd.endsWith('-15') ? '01' : '16'}`,
				cutoffEnd,
				payDate: cutoffEnd,
				frequency: 'semi_monthly',
				dayFactor: 313
			})
			.returning({ id: payrollRuns.id });
		runIds.push(run!.id);
		const [batch] = await db
			.insert(payrollBatches)
			.values({ runId: run!.id, establishmentId: est, status })
			.returning({ id: payrollBatches.id });
		await db.insert(payrollRunLines).values({
			runId: run!.id,
			batchId: batch!.id,
			employeeId: emp,
			establishmentId: est,
			personRef: mintRef('person'),
			employeeNo: 'TH1',
			employeeName: 'Test, Th',
			position: 'Tester',
			payBasis: 'monthly',
			baseRateCentavos: 1_000_000,
			earnings: { basic },
			grossCentavos: basic,
			deductions: { tardiness_undertime: late },
			employerContributions: {},
			netPayCentavos: basic - late
		});
	};

	beforeAll(async () => {
		org = await testOrgId();
		const [e] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: tag, name: '13th month test', orgRef: mintRef('org') })
			.returning({ id: establishments.id });
		est = e!.id;
		emp = await createTestStaff(est, { employeeNo: 'TH1', firstName: 'Th', hiredOn: '2026-01-01' });
		await slip('2026-03-15', 'locked', 1_000_000, 10_000);
		await slip('2026-03-31', 'released', 1_000_000, 0);
		await slip('2026-04-15', 'draft', 500_000, 0);
	});
	afterAll(async () => {
		if (sepId) {
			await db.delete(separationItems).where(eq(separationItems.separationId, sepId));
			await db.delete(separationClearance).where(eq(separationClearance.separationId, sepId));
			await db.delete(separations).where(eq(separations.id, sepId));
		}
		if (runIds.length) await db.delete(payrollRuns).where(inArray(payrollRuns.id, runIds));
		await cleanupTestEstablishments([est]);
	});

	it('adds up basic and late deductions from locked and released payslips only, and says what is still draft', async () => {
		const r = await T.thirteenthMonthFor(emp, 2026, '2026-04-30');
		expect(r).toMatchObject({
			entitled: true,
			basicEarned: 2_000_000,
			lateDeductions: 10_000,
			amount: 165_833,
			finalPayslips: 2,
			draftPayslips: 1,
			serviceDays: 120
		});
		// A cutoff that begins after the last day is not counted; the one the last day falls in is.
		expect((await T.thirteenthMonthFor(emp, 2026, '2026-03-10')).basicEarned).toBe(1_000_000);
		expect((await T.thirteenthMonthFor(emp, 2026, '2026-03-20')).basicEarned).toBe(2_000_000);
	});

	it('pays nothing to someone marked not entitled, or who served under a month', async () => {
		await T.setThirteenthMonthCovered(org, emp, false, 'Managerial');
		expect(await T.thirteenthMonthFor(emp, 2026, '2026-04-30')).toMatchObject({
			entitled: false,
			reason: 'not_covered',
			amount: 0,
			note: 'Managerial'
		});
		await T.setThirteenthMonthCovered(org, emp, true, null);
		await db.update(employees).set({ hiredOn: '2026-04-20' }).where(eq(employees.id, emp));
		expect(await T.thirteenthMonthFor(emp, 2026, '2026-04-30')).toMatchObject({ entitled: false, reason: 'under_one_month' });
		await db.update(employees).set({ hiredOn: '2026-01-01' }).where(eq(employees.id, emp));
	});

	it('puts the pro-rated amount on the final-pay statement once, as a credit', async () => {
		const sep = await S.startSeparation(org, { employeeId: emp, kind: 'resigned', lastDay: '2026-04-30' }, null);
		sepId = sep.id;
		const view = await S.getSeparation(org, sepId);
		expect(view.thirteenth).toMatchObject({ entitled: true, amount: 165_833, addedAmount: null });

		await S.addThirteenthMonth(org, sepId);
		const after = await S.getSeparation(org, sepId);
		expect(after.totals.credits).toBe(165_833);
		expect(after.thirteenth.addedAmount).toBe(165_833);
		await expect(S.addThirteenthMonth(org, sepId)).rejects.toThrow(/already in this statement/);
	});
});
