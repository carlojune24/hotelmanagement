import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, cleanupTestOrg, createTestOrg, createTestStaff, testOrgId } from './test-helpers';

/**
 * End-to-end scenarios against the live DB: a mock March 2026 DTR for one establishment, two payroll
 * cutoffs built from it, salary adjustments, and every way a person can leave (clean resignation,
 * resignation with a loan, termination with money owed, under a month's service, a moved last day).
 * Throwaway data, removed afterwards. Skipped without a database.
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

describe.skipIf(!hasDb)('HR scenarios (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const S = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { eq, and, inArray } = await import('drizzle-orm');
	const P = await import('./payroll');
	const SAL = await import('./salary');
	const SEP = await import('./separations');
	const LN = await import('./loans');

	const tag = `scn-${Math.random().toString(36).slice(2, 10)}`;
	const DAILY = Math.round((1_000_000 * 12) / 313); // ₱10,000/month at the 313-day factor
	let org = '';
	let est = '';
	let originalConfig: unknown = {};
	const runIds: string[] = [];
	let batch1 = ''; // Mar 1–15
	let batch2 = ''; // Mar 16–31
	let loanTypeKey = '';

	let wes = ''; // stays; salary adjustments
	let ravi = ''; // resigns Mar 11, nothing owed either way
	let sol = ''; // resigns Mar 13 with a ₱10,000 loan
	let tess = ''; // terminated Mar 6, owes the company more than her pay
	let uma = ''; // hired Mar 5, leaves Mar 13: under a month of service

	const workDays = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13'];

	const dtr = async (emp: string, date: string) => {
		const [s] = await db
			.insert(S.schedules)
			.values({ establishmentId: est, employeeId: emp, date, isRestDay: false, startTime: '08:00', endTime: '17:00', breakMinutes: 60 })
			.returning({ id: S.schedules.id });
		await db.insert(S.dtrEntries).values({
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
	const lineOf = async (batchId: string, emp: string) => (await P.listBatchLines(batchId)).find((l) => l.employeeId === emp);
	const sep = async (id: string) => (await SEP.getSeparation(org, id)).sep;
	const view = (id: string) => SEP.getSeparation(org, id);
	const empRow = async (id: string) => (await db.select().from(S.employees).where(eq(S.employees.id, id)))[0]!;
	const assignmentEnd = async (id: string) =>
		(await db.select().from(S.employeeAssignments).where(eq(S.employeeAssignments.employeeId, id)))[0]!.endDate;

	beforeAll(async () => {
		// Own company unless KEEP_MOCK: the dev DB's real org already has March 2026 payroll, which blocks these runs.
		org = process.env.KEEP_MOCK ? await testOrgId() : await createTestOrg();
		const o = await db.select({ c: S.organizations.config }).from(S.organizations).where(eq(S.organizations.id, org));
		originalConfig = o[0]!.c;
		await P.saveDayFactor(org, 313);
		const [e] = await db
			.insert(S.establishments)
			.values({ organizationId: org, kind: 'business', slug: tag, name: 'Scenario hotel', orgRef: mintRef('org') })
			.returning({ id: S.establishments.id });
		est = e!.id;

		wes = await createTestStaff(est, { employeeNo: 'SC1', firstName: 'Wes' });
		ravi = await createTestStaff(est, { employeeNo: 'SC2', firstName: 'Ravi' });
		sol = await createTestStaff(est, { employeeNo: 'SC3', firstName: 'Sol' });
		tess = await createTestStaff(est, { employeeNo: 'SC4', firstName: 'Tess' });
		uma = await createTestStaff(est, { employeeNo: 'SC5', firstName: 'Uma', hiredOn: '2026-03-05' });

		// Mock DTR: everyone worked the days they were still employed.
		const upTo: Record<string, string> = { [wes]: '2026-03-13', [ravi]: '2026-03-11', [sol]: '2026-03-13', [tess]: '2026-03-06', [uma]: '2026-03-13' };
		for (const [emp, last] of Object.entries(upTo)) {
			for (const d of workDays) {
				if (d > last) continue;
				if (emp === uma && d < '2026-03-05') continue;
				await dtr(emp, d);
			}
		}
		for (const d of ['2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20', '2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-30', '2026-03-31']) await dtr(wes, d);
		await db.insert(S.dtrSubmissions).values({ establishmentId: est, cutoffStart: '2026-03-01', cutoffEnd: '2026-03-31', status: 'received' });

		loanTypeKey = (await LN.createLoanType(org, { name: `Scenario loan ${tag}`, remitTo: 'none' })).key;
	});

	afterAll(async () => {
		// KEEP_MOCK=1 leaves the mock establishment, DTR, payroll and separations in place to browse in the app;
		// scripts/remove-mock-data.sql takes them out again.
		if (process.env.KEEP_MOCK) {
			await db.update(S.organizations).set({ config: originalConfig as object }).where(eq(S.organizations.id, org));
			return;
		}
		for (const id of runIds) await db.delete(S.payrollRuns).where(eq(S.payrollRuns.id, id));
		const people = [wes, ravi, sol, tess, uma].filter(Boolean);
		if (people.length) {
			const seps = (await db.select({ id: S.separations.id }).from(S.separations).where(inArray(S.separations.employeeId, people))).map((r) => r.id);
			const loans = (await db.select({ id: S.employeeLoans.id }).from(S.employeeLoans).where(inArray(S.employeeLoans.employeeId, people))).map((r) => r.id);
			if (loans.length) await db.delete(S.employeeLoanPayments).where(inArray(S.employeeLoanPayments.loanId, loans));
			if (seps.length) {
				await db.delete(S.separationItems).where(inArray(S.separationItems.separationId, seps));
				await db.delete(S.separationClearance).where(inArray(S.separationClearance.separationId, seps));
				await db.delete(S.separations).where(inArray(S.separations.id, seps));
			}
			if (loans.length) await db.delete(S.employeeLoans).where(inArray(S.employeeLoans.id, loans));
			await db.delete(S.salaryHistory).where(inArray(S.salaryHistory.employeeId, people));
		}
		await cleanupTestEstablishments([est]);
		await db.delete(S.loanTypes).where(and(eq(S.loanTypes.organizationId, org), eq(S.loanTypes.key, loanTypeKey)));
		await cleanupTestOrg(org);
	});

	// ---------------------------------------------------------------- payroll baseline
	it('builds both March cutoffs from the mock DTR', async () => {
		const r1 = await P.createRun(org, { cutoffStart: '2026-03-01', cutoffEnd: '2026-03-15', payDate: '2026-03-20', frequency: 'semi_monthly' }, null);
		const r2 = await P.createRun(org, { cutoffStart: '2026-03-16', cutoffEnd: '2026-03-31', payDate: '2026-04-05', frequency: 'semi_monthly' }, null);
		runIds.push(r1.id, r2.id);
		batch1 = (await P.getRun(r1.id)).batches.find((b) => b.establishmentId === est)!.id;
		batch2 = (await P.getRun(r2.id)).batches.find((b) => b.establishmentId === est)!.id;
		const g = await P.generateBatch(batch1);
		expect(g.generated).toBe(5);
		for (const p of [wes, ravi, sol, tess, uma]) {
			const l = await lineOf(batch1, p);
			expect(l, `line for ${p}`).toBeDefined();
			expect(l!.netPayCentavos).toBeGreaterThan(0);
		}
	});

	// ---------------------------------------------------------------- salary adjustment
	describe('salary adjustment', () => {
		const adj = (o: Partial<Parameters<typeof SAL.adjustSalary>[1]> = {}) =>
			SAL.adjustSalary(org, { employeeId: wes, payBasis: 'monthly', rate: 15_000, effectiveFrom: '2026-03-09', remarks: 'Promotion', ...o }, null);

		it('refuses a date before hire, a no-op, and a duplicate date', async () => {
			await expect(adj({ effectiveFrom: '2023-12-31' })).rejects.toThrow(/before they were hired/);
			await expect(adj({ rate: 10_000 })).rejects.toThrow(/same as the salary/);
			const { entry } = await adj();
			await expect(adj({ rate: 16_000 })).rejects.toThrow(/already an adjustment on that date/);
			await db.delete(S.salaryHistory).where(eq(S.salaryHistory.id, entry.id));
			await db.update(S.employees).set({ baseRateCentavos: 1_000_000 }).where(eq(S.employees.id, wes));
		});

		it('updates the current rate, keeps the old one as history, and reprices the cutoff by day', async () => {
			const { entry, previous } = await adj({ rate: 20_000 });
			expect(previous).toMatchObject({ baseRateCentavos: 1_000_000 });
			expect((await empRow(wes)).baseRateCentavos).toBe(2_000_000);
			await P.generateBatch(batch1);
			const l = (await lineOf(batch1, wes))!;
			// 8 of 15 days at ₱10,000 and 7 at ₱20,000, halved for a semi-monthly cut.
			expect((l.earnings as { basic: number }).basic).toBe(Math.round((1_000_000 * 8 + 2_000_000 * 7) / 15 / 2));
			expect((l.detail as { rateChanges: unknown[] }).rateChanges).toHaveLength(1);
			// A change effective the next cutoff does not touch this one.
			await db.delete(S.salaryHistory).where(eq(S.salaryHistory.id, entry.id));
			await db.update(S.employees).set({ baseRateCentavos: 1_000_000 }).where(eq(S.employees.id, wes));
			await adj({ rate: 20_000, effectiveFrom: '2026-03-16' });
			await P.generateBatch(batch1);
			expect((await lineOf(batch1, wes))!.baseRateCentavos).toBe(1_000_000);
			await P.generateBatch(batch2);
			expect((await lineOf(batch2, wes))!.baseRateCentavos).toBe(2_000_000);
			expect(((await lineOf(batch2, wes))!.detail as { rateChanges?: unknown[] }).rateChanges ?? []).toHaveLength(0);
		});

		it('says how many already-locked payslips a back-dated adjustment cannot change', async () => {
			await P.acknowledgeRates((await P.getRun(runIds[0]!)).run.id, null);
			await P.generateBatch(batch1);
			await P.lockBatch(batch1, null);
			const { entry, lockedPayslipsAffected } = await adj({ rate: 12_000, effectiveFrom: '2026-03-02' });
			expect(lockedPayslipsAffected).toBe(1);
			// the locked line keeps its frozen amount
			expect((await lineOf(batch1, wes))!.baseRateCentavos).toBe(1_000_000);
			await db.delete(S.salaryHistory).where(eq(S.salaryHistory.id, entry.id));
			await db.update(S.employees).set({ baseRateCentavos: 1_000_000 }).where(eq(S.employees.id, wes));
		});
	});

	// ---------------------------------------------------------------- separations
	describe('separation scenarios', () => {
		let ravi_sep = '';
		let sol_sep = '';
		let tess_sep = '';
		let uma_sep = '';

		it('start: ends their assignment on the last day, marks them separated, and refuses a second record', async () => {
			const s = await SEP.startSeparation(org, { employeeId: ravi, kind: 'resigned', lastDay: '2026-03-11' }, null);
			ravi_sep = s.id;
			expect(await assignmentEnd(ravi)).toBe('2026-03-11');
			expect((await empRow(ravi)).status).toBe('separated'); // the date is in the past
			await expect(SEP.startSeparation(org, { employeeId: ravi, kind: 'resigned', lastDay: '2026-03-11' }, null)).rejects.toThrow(/already has a separation/);
			const v = await view(ravi_sep);
			expect(v.steps.checklist).toBe(false);
		});

		it('payroll: pays them up to their last day, then not at all in the next cutoff', async () => {
			for (const [p, kind, last] of [
				[sol, 'resigned', '2026-03-13'],
				[tess, 'terminated', '2026-03-06'],
				[uma, 'resigned', '2026-03-13']
			] as const) {
				const s = await SEP.startSeparation(org, { employeeId: p, kind, lastDay: last }, null);
				if (p === sol) sol_sep = s.id;
				if (p === tess) tess_sep = s.id;
				if (p === uma) uma_sep = s.id;
			}
			await P.generateBatch(batch2);
			for (const p of [ravi, sol, tess, uma]) expect(await lineOf(batch2, p), `no 2nd-half line for ${p}`).toBeUndefined();
			expect(await lineOf(batch2, wes)).toBeDefined();
		});

		it('clean resignation: 13th month from locked payslips, pay out, checklist, clear', async () => {
			// batch1 was locked in the salary tests; Ravi's payslip is final.
			const added = await SEP.addThirteenthMonth(org, ravi_sep);
			expect(added.result.finalPayslips).toBe(1);
			// Regression: Ravi left on the 11th, mid-cutoff, so the Mar 1�15 payslip must count toward his 13th month.
			expect(added.result.basicEarned).toBeGreaterThan(0);
			expect(added.item.amountCentavos).toBe(Math.round((added.result.basicEarned - added.result.lateDeductions) / 12));
			await expect(SEP.addThirteenthMonth(org, ravi_sep)).rejects.toThrow(/already in this statement/);

			await SEP.addItem(org, { separationId: ravi_sep, kind: 'credit', label: 'Unused leave conversion', amount: 1_500 });
			let v = await view(ravi_sep);
			expect(v.totals.payToEmployee).toBe(v.totals.credits);
			expect(v.totals.stillOwed).toBe(0);

			await expect(SEP.clearSeparation(org, ravi_sep, null)).rejects.toThrow(/hand over the final pay/);
			await SEP.markFinalPayPaid(org, ravi_sep, null);
			await expect(SEP.markFinalPayPaid(org, ravi_sep, null)).rejects.toThrow(/already marked as paid/);
			await expect(SEP.clearSeparation(org, ravi_sep, null)).rejects.toThrow(/finish the clearance checklist/);
			for (const c of v.clearance) await SEP.toggleClearance(org, c.id, true, null);
			await SEP.clearSeparation(org, ravi_sep, null);
			v = await view(ravi_sep);
			expect(v.sep.status).toBe('cleared');
			await expect(SEP.addItem(org, { separationId: ravi_sep, kind: 'credit', label: 'Late add', amount: 10 })).rejects.toThrow(/already cleared/);
			await expect(SEP.setLastDay(org, ravi_sep, '2026-03-12')).rejects.toThrow(/already cleared/);
		});

		it('with a loan: final pay settles it, never more than the pay or the balance, paid off at zero', async () => {
			const loan = await LN.createLoan(
				org,
				{ employeeId: sol, kind: loanTypeKey, principal: 10_000, amortization: 1_000, alreadyPaid: 0, startPeriod: '2026-03' } as never,
				null
			);
			await SEP.addItem(org, { separationId: sol_sep, kind: 'credit', label: 'Final salary', amount: 4_000 });
			let v = await view(sol_sep);
			expect(v.totals.loanOwed).toBe(1_000_000);
			expect(v.totals.payToEmployee).toBe(400_000);
			await expect(SEP.applyToLoan(org, { separationId: sol_sep, loanId: loan.id, amount: 4_500 }, null)).rejects.toThrow(/more than the final pay/);
			await SEP.applyToLoan(org, { separationId: sol_sep, loanId: loan.id, amount: 3_000 }, null);
			v = await view(sol_sep);
			expect(v.totals).toMatchObject({ loanApplied: 300_000, payToEmployee: 100_000, loanOwed: 700_000, stillOwed: 700_000 });
			// the credit that funded the settlement cannot be voided from under it
			const credit = v.items.find((i) => i.kind === 'credit')!;
			await expect(SEP.voidItem(org, credit.id, 'wrong amount')).rejects.toThrow(/Undo them first/);
			// final pay handed over, but the loan balance blocks clearance
			await SEP.markFinalPayPaid(org, sol_sep, null);
			for (const c of v.clearance) await SEP.toggleClearance(org, c.id, true, null);
			await expect(SEP.clearSeparation(org, sol_sep, null)).rejects.toThrow(/settle or write off/);
			// they repay the rest outside payroll; the loan pays off and the separation can clear
			await LN.addPayment(org, { loanId: loan.id, paidOn: '2026-03-14', amount: 7_000 } as never, null);
			await SEP.clearSeparation(org, sol_sep, null);
			expect((await sep(sol_sep)).status).toBe('cleared');
			const [l] = await db.select().from(S.employeeLoans).where(eq(S.employeeLoans.id, loan.id));
			expect(l!.status).toBe('paid_off');
		});

		it('terminated owing more than their pay: charge shows as owed; receipts and write-offs are bounded', async () => {
			await SEP.addItem(org, { separationId: tess_sep, kind: 'credit', label: 'Final salary', amount: 1_000 });
			await SEP.addItem(org, { separationId: tess_sep, kind: 'charge', label: 'Unreturned uniform + locker key', amount: 1_800 });
			let v = await view(tess_sep);
			expect(v.totals).toMatchObject({ payToEmployee: 0, nonLoanOwed: 80_000, stillOwed: 80_000 });
			await expect(SEP.markFinalPayPaid(org, tess_sep, null)).rejects.toThrow(/no final pay to hand over/);
			await expect(SEP.addItem(org, { separationId: tess_sep, kind: 'receipt', label: 'Cash', amount: 900 })).rejects.toThrow(/more than the amount still owed/);
			await SEP.addItem(org, { separationId: tess_sep, kind: 'receipt', label: 'Cash received', amount: 500 });
			await SEP.addItem(org, { separationId: tess_sep, kind: 'writeoff', label: 'Written off by HR', amount: 300 });
			v = await view(tess_sep);
			expect(v.totals.nonLoanOwed).toBe(0);
			// nothing to pay out → "final pay" step is not required and clearing works after the checklist
			for (const c of v.clearance) await SEP.toggleClearance(org, c.id, true, null);
			await SEP.clearSeparation(org, tess_sep, null);
			expect((await sep(tess_sep)).status).toBe('cleared');
		});

		it('under a month of service: no 13th month; marking not-covered needs a reason', async () => {
			await expect(SEP.addThirteenthMonth(org, uma_sep)).rejects.toThrow(/less than one month|no basic pay/);
			await expect(SEP.setEntitlement(org, uma_sep, false, '')).rejects.toThrow(/Say why/);
			await SEP.setEntitlement(org, uma_sep, false, 'Managerial staff');
			await expect(SEP.addThirteenthMonth(org, uma_sep)).rejects.toThrow(/not entitled/);
			await SEP.setEntitlement(org, uma_sep, true, '');
		});

		it('moving the last day moves the assignment end; a voided line needs a reason', async () => {
			await SEP.setLastDay(org, uma_sep, '2026-03-14');
			expect(await assignmentEnd(uma)).toBe('2026-03-14');
			expect((await sep(uma_sep)).lastDay).toBe('2026-03-14');
			const { item } = await SEP.addItem(org, { separationId: uma_sep, kind: 'credit', label: 'Final salary', amount: 500 });
			await expect(SEP.voidItem(org, item.id, 'x')).rejects.toThrow(/Say why/);
			await SEP.voidItem(org, item.id, 'entered twice');
			await expect(SEP.voidItem(org, item.id, 'again please')).rejects.toThrow(/already voided/);
			expect((await view(uma_sep)).totals.credits).toBe(0);
		});

		it('a future last day keeps them active until it arrives', async () => {
			const future = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
			const p = await createTestStaff(est, { employeeNo: 'SC9', firstName: 'Fay' });
			const s = await SEP.startSeparation(org, { employeeId: p, kind: 'end_of_contract', lastDay: future }, null);
			expect((await empRow(p)).status).not.toBe('separated');
			expect(await assignmentEnd(p)).toBe(future);
			await db.delete(S.separationClearance).where(eq(S.separationClearance.separationId, s.id));
			await db.delete(S.separations).where(eq(S.separations.id, s.id));
		});
	});
});
