import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';

async function hasDb() {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}
const live = await hasDb();

describe.skipIf(!live)('bonus batches (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const {
		bonusBatches, bonusLines, establishments, payrollBatches, payrollRunLines, payrollRuns,
		separationClearance, separationItems, separations
	} = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { eq, inArray } = await import('drizzle-orm');
	const B = await import('./bonuses');
	const S = await import('./separations');

	const tag = `bonustest-${Math.random().toString(36).slice(2, 10)}`;
	let org = '';
	let est = '';
	let ana = '';
	let bea = '';
	const runIds: string[] = [];
	let sepId = '';
	let midId = '';
	let endId = '';
	let otherId = '';

	const slip = async (employeeId: string, name: string, cutoffEnd: string, basic: number) => {
		const [run] = await db
			.insert(payrollRuns)
			.values({ organizationId: org, cutoffStart: `${cutoffEnd.slice(0, 7)}-01`, cutoffEnd, payDate: cutoffEnd, frequency: 'semi_monthly', dayFactor: 313 })
			.returning({ id: payrollRuns.id });
		runIds.push(run!.id);
		const [batch] = await db.insert(payrollBatches).values({ runId: run!.id, establishmentId: est, status: 'released' }).returning({ id: payrollBatches.id });
		await db.insert(payrollRunLines).values({
			runId: run!.id, batchId: batch!.id, employeeId, establishmentId: est, personRef: mintRef('person'),
			employeeNo: name, employeeName: `Test, ${name}`, position: 'Tester', payBasis: 'monthly', baseRateCentavos: 1_000_000,
			earnings: { basic }, grossCentavos: basic, deductions: { tardiness_undertime: 0 }, employerContributions: {}, netPayCentavos: basic
		});
	};

	beforeAll(async () => {
		org = await testOrgId();
		const [e] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: tag, name: 'Bonus test', orgRef: mintRef('org') })
			.returning({ id: establishments.id });
		est = e!.id;
		ana = await createTestStaff(est, { employeeNo: 'BN1', firstName: 'Ana', hiredOn: '2025-01-01' });
		bea = await createTestStaff(est, { employeeNo: 'BN2', firstName: 'Bea', hiredOn: '2025-01-01' });
		await slip(ana, 'Ana', '2026-03-15', 1_200_000);
		await slip(ana, 'Ana', '2026-06-15', 1_200_000);
		await slip(ana, 'Ana', '2026-12-15', 1_200_000);
		await slip(bea, 'Bea', '2026-03-15', 600_000);
		// Bea leaves in April and her 13th month goes out with her final pay.
		const sep = await S.startSeparation(org, { employeeId: bea, kind: 'resigned', lastDay: '2026-04-30' }, null);
		sepId = sep.id;
		await S.addThirteenthMonth(org, sepId);
	});
	afterAll(async () => {
		const batches = await db.select({ id: bonusBatches.id }).from(bonusBatches).where(eq(bonusBatches.establishmentId, est));
		const ids = batches.map((b) => b.id);
		if (ids.length) {
			await db.delete(bonusLines).where(inArray(bonusLines.batchId, ids));
			await db.delete(bonusBatches).where(inArray(bonusBatches.id, ids));
		}
		if (sepId) {
			await db.delete(separationItems).where(eq(separationItems.separationId, sepId));
			await db.delete(separationClearance).where(eq(separationClearance.separationId, sepId));
			await db.delete(separations).where(eq(separations.id, sepId));
		}
		if (runIds.length) await db.delete(payrollRuns).where(inArray(payrollRuns.id, runIds));
		await cleanupTestEstablishments([est]);
	});

	const batch = async (id: string) => (await B.listBatches(org, 2026)).find((b) => b.id === id)!;
	const lineOf = (b: Awaited<ReturnType<typeof batch>>, name: string) => b.lines.find((l) => l.employeeName === `Test, ${name}`)!;

	it('accrues the mid-year installment from basic earned to the cutoff, and skips someone paid in final pay', async () => {
		const out = await B.createBatches(org, { kind: 'thirteenth_mid_year', year: 2026, establishmentId: est }, null);
		midId = out.created[0]!;
		const b = await batch(midId);
		expect(lineOf(b, 'Ana')).toMatchObject({ basicEarned: 2_400_000, accrued: 200_000, amount: 200_000, excludedReason: null });
		expect(lineOf(b, 'Bea')).toMatchObject({ amount: 0, excludedReason: 'paid_in_final_pay', note: 'Separated' });
		expect(b.total).toBe(200_000);
		await expect(B.createBatches(org, { kind: 'thirteenth_mid_year', year: 2026, establishmentId: est }, null)).rejects.toThrow(/already exists/);
	});

	it('pays the year-end balance after the installment, only once issued', async () => {
		await B.issueBatch(org, midId, null);
		const out = await B.createBatches(org, { kind: 'thirteenth_year_end', year: 2026, establishmentId: est }, null);
		endId = out.created[0]!;
		const b = await batch(endId);
		expect(lineOf(b, 'Ana')).toMatchObject({ basicEarned: 3_600_000, accrued: 300_000, alreadyPaid: 200_000, amount: 100_000 });
		expect(lineOf(b, 'Bea').excludedReason).toBe('paid_in_final_pay');
	});

	it('will not issue the year-end while a mid-year draft would be paid twice, nor reopen an installment already deducted', async () => {
		await B.reopenBatch(org, midId);
		await expect(B.issueBatch(org, endId, null)).rejects.toThrow(/mid-year installment first/);
		await B.issueBatch(org, midId, null);
		await B.issueBatch(org, endId, null);
		await expect(B.reopenBatch(org, midId)).rejects.toThrow(/Reopen that first/);
		await expect(B.refreshBatch(org, endId)).rejects.toThrow(/issued/);
	});

	it('reports each person across mid-year, year-end and final pay for the DOLE sheet', async () => {
		const r = await B.thirteenthMonthReport(org, 2026);
		const ana = r.rows.find((x) => x.employeeName === 'Test, Ana')!;
		expect(ana).toMatchObject({ entitled: 300_000, paidMidYear: 200_000, paidYearEnd: 100_000, paidFinalPay: 0, paid: 300_000, status: 'paid' });
		const bea = r.rows.find((x) => x.employeeName === 'Test, Bea')!;
		expect(bea.paidFinalPay).toBeGreaterThan(0);
		expect(bea.paid).toBe(bea.paidFinalPay);
		expect(r.totals.paid).toBe(r.rows.reduce((t, x) => t + x.paid, 0));
	});

	it('lists a leaver whose 13th month went out in final pay even when no batch has a line for them', async () => {
		const cy = await createTestStaff(est, { employeeNo: 'BN3', firstName: 'Cy', hiredOn: '2025-01-01' });
		const sep = await S.startSeparation(org, { employeeId: cy, kind: 'resigned', lastDay: '2026-02-28' }, null);
		await db.insert(separationItems).values({
			separationId: sep.id, kind: 'credit', label: '13th month pay', amountCentavos: 12_345, source: 'thirteenth_month', sourceYear: 2026
		});
		try {
			const r = await B.thirteenthMonthReport(org, 2026);
			const row = r.rows.find((x) => x.employeeId === cy)!;
			expect(row).toMatchObject({ paidFinalPay: 12_345, paid: 12_345, status: 'paid' });
		} finally {
			await db.delete(separationItems).where(eq(separationItems.separationId, sep.id));
			await db.delete(separationClearance).where(eq(separationClearance.separationId, sep.id));
			await db.delete(separations).where(eq(separations.id, sep.id));
		}
	});

	it('creates one-off bonuses with an amount per person, editable until issued', async () => {
		const out = await B.createBatches(org, { kind: 'other', year: 2026, establishmentId: est, label: 'Christmas bonus', defaultAmount: 500 }, null);
		otherId = out.created[0]!;
		let b = await batch(otherId);
		expect(b.lines.map((l) => l.employeeName)).toEqual(['Test, Ana']); // Bea has separated
		expect(b.total).toBe(50_000);
		await B.setLineAmount(org, lineOf(b, 'Ana').id, 1_000);
		b = await batch(otherId);
		expect(b.total).toBe(100_000);
		await expect(B.refreshBatch(org, otherId)).rejects.toThrow(/not computed/);
		await B.issueBatch(org, otherId, null);
		await expect(B.setLineAmount(org, lineOf(b, 'Ana').id, 5)).rejects.toThrow(/issued/);
	});

	it('flags anyone whose benefits for the year pass the tax exemption', async () => {
		await B.reopenBatch(org, otherId);
		let b = await batch(otherId);
		expect(lineOf(b, 'Ana').overTaxExemption).toBe(false);
		expect(lineOf(b, 'Ana').taxable).toBe(0);
		await B.setLineAmount(org, lineOf(b, 'Ana').id, 100_000); // ₱100,000 on top of the 13th month already issued
		b = await batch(otherId);
		expect(lineOf(b, 'Ana').overTaxExemption).toBe(true);
		// Only the part above ₱90,000 is taxable, and never more than this payment.
		const taxable = lineOf(b, 'Ana').taxable;
		expect(taxable).toBeGreaterThan(0);
		expect(taxable).toBeLessThanOrEqual(100_000_00);
	});

	it('deletes a draft batch but not an issued one', async () => {
		await expect(B.deleteDraft(org, endId)).rejects.toThrow(/issued/);
		await B.deleteDraft(org, otherId);
		expect((await B.listBatches(org, 2026)).some((x) => x.id === otherId)).toBe(false);
	});
});
