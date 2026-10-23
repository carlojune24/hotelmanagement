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

describe.skipIf(!live)('year-end annualization (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { employees, establishments, payrollBatches, payrollRunLines, payrollRuns } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { eq, inArray } = await import('drizzle-orm');
	const { computeWithholdingTax, annualTaxDue } = await import('@mm/hr-core');
	const A = await import('./annualization');

	const tag = `annualtest-${Math.random().toString(36).slice(2, 10)}`;
	const YEAR = 2031;
	let org = '';
	let est = '';
	let ana = '';
	let draftBatch = '';
	let draftLine = '';
	const runIds: string[] = [];
	const gross = 5_000_000; // ₱50,000 a cutoff
	const regular = computeWithholdingTax(gross, 'semi_monthly');

	const slip = async (employeeId: string, payDate: string, status: 'released' | 'draft') => {
		const [run] = await db
			.insert(payrollRuns)
			.values({ organizationId: org, cutoffStart: `${payDate.slice(0, 7)}-01`, cutoffEnd: payDate, payDate, frequency: 'semi_monthly', dayFactor: 313 })
			.returning({ id: payrollRuns.id });
		runIds.push(run!.id);
		const [batch] = await db
			.insert(payrollBatches)
			.values({ runId: run!.id, establishmentId: est, status, generatedAt: new Date() })
			.returning({ id: payrollBatches.id });
		const [line] = await db
			.insert(payrollRunLines)
			.values({
				runId: run!.id,
				batchId: batch!.id,
				employeeId,
				establishmentId: est,
				personRef: mintRef('person'),
				employeeNo: 'AN1',
				employeeName: 'Test, Ana',
				position: 'Tester',
				payBasis: 'monthly',
				baseRateCentavos: 10_000_000,
				earnings: { basic: gross, overtime: 0, holiday_premium: 0, night_diff: 0, allowances: 0, other: 0 },
				grossCentavos: gross,
				deductions: { sss_ee: 0, philhealth_ee: 0, pagibig_ee: 0, withholding_tax: regular, cash_advance: 0, loans: 0, tardiness_undertime: 0, other: 0 },
				employerContributions: {},
				detail: { taxableCentavos: gross },
				netPayCentavos: gross - regular
			})
			.returning({ id: payrollRunLines.id });
		return { batchId: batch!.id, lineId: line!.id };
	};

	beforeAll(async () => {
		org = await testOrgId();
		const [e] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: tag, name: 'Annual test', orgRef: mintRef('org') })
			.returning({ id: establishments.id });
		est = e!.id;
		ana = await createTestStaff(est, { employeeNo: 'AN1', firstName: 'Ana', hiredOn: '2030-01-01' });
		await slip(ana, `${YEAR}-06-15`, 'released');
		const d = await slip(ana, `${YEAR}-12-15`, 'draft');
		draftBatch = d.batchId;
		draftLine = d.lineId;
	});
	afterAll(async () => {
		if (runIds.length) await db.delete(payrollRuns).where(inArray(payrollRuns.id, runIds));
		await cleanupTestEstablishments([est]);
	});

	const mine = async (target: { batchId: string } | null) =>
		(await A.annualizationRows(org, YEAR, target)).find((r) => r.employeeId === ana)!;

	it('counts only final payslips unless a draft batch is the target', async () => {
		const final = await mine(null);
		expect(final.payslips).toBe(1);
		expect(final.gross).toBe(gross);
		const withDraft = await mine({ batchId: draftBatch });
		expect(withDraft.payslips).toBe(2);
		expect(withDraft.gross).toBe(gross * 2);
	});

	it('settles the whole year: tax on the annual taxable less what was withheld, and refunds an excess', async () => {
		const r = await mine({ batchId: draftBatch });
		expect(r.taxable).toBe(gross * 2);
		expect(r.taxDue).toBe(annualTaxDue(gross * 2));
		expect(r.withheld).toBe(regular * 2);
		expect(r.settlement).toBe(r.taxDue - regular * 2);
		expect(r.settlement).toBeLessThan(0); // ₱100,000 for the year is under the ₱250,000 threshold
	});

	it('applies the settlement to the draft line, and applying again changes nothing', async () => {
		const first = await A.applyAnnualization(org, YEAR, draftBatch);
		expect(first.applied).toBe(1);
		const refund = -(annualTaxDue(gross * 2) - regular * 2);
		let line = await db.select().from(payrollRunLines).where(eq(payrollRunLines.id, draftLine)).then((r) => r[0]!);
		expect((line.detail as { annualTaxAdjustmentCentavos: number }).annualTaxAdjustmentCentavos).toBe(-refund);
		expect((line.earnings as { other: number }).other).toBe(refund);
		expect(line.grossCentavos).toBe(gross + refund);
		expect((line.deductions as { withholding_tax: number }).withholding_tax).toBe(regular);

		await A.applyAnnualization(org, YEAR, draftBatch);
		line = await db.select().from(payrollRunLines).where(eq(payrollRunLines.id, draftLine)).then((r) => r[0]!);
		expect(line.grossCentavos).toBe(gross + refund);
		const again = await mine({ batchId: draftBatch });
		expect(again.settlement).toBe(-refund);
	});

	it('refuses a batch that is not a draft or not paid that year', async () => {
		await expect(A.applyAnnualization(org, 2032, draftBatch)).rejects.toThrow(/not paid in 2032/);
		await db.update(payrollBatches).set({ status: 'locked' }).where(eq(payrollBatches.id, draftBatch));
		await expect(A.applyAnnualization(org, YEAR, draftBatch)).rejects.toThrow(/draft/);
	});

	it('uses a previous employer for the year and the exempt flag', async () => {
		await db.update(payrollBatches).set({ status: 'released' }).where(eq(payrollBatches.id, draftBatch));
		await db
			.update(employees)
			.set({ prevEmployerYear: YEAR, prevEmployerName: 'Old Co', prevEmployerTaxableCentavos: 30_000_000, prevEmployerWithheldCentavos: 1_000_000 })
			.where(eq(employees.id, ana));
		let r = await mine(null);
		expect(r.prevTaxable).toBe(30_000_000);
		expect(r.taxable).toBe(r.basicTaxable + 30_000_000);
		expect(r.settlement).toBe(r.taxDue - r.withheld - 1_000_000);
		await db.update(employees).set({ withholdingExempt: true }).where(eq(employees.id, ana));
		r = await mine(null);
		expect(r.taxDue).toBe(0);
	});
});
