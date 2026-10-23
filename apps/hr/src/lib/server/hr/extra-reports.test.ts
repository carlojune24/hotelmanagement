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

describe.skipIf(!live)('extra reports (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { employees, establishments, payrollBatches, payrollRunLines, payrollRuns } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { eq, inArray } = await import('drizzle-orm');
	const X = await import('./extra-reports');

	const YEAR = 2034;
	const tag = `extra-${Math.random().toString(36).slice(2, 10)}`;
	let org = '';
	let est = '';
	let ana = '';
	let ben = '';
	const runIds: string[] = [];
	const peso = (n: number) => Math.round(n * 100);

	const slip = async (
		employeeId: string,
		payDate: string,
		status: 'released' | 'draft',
		o: { gross: number; sss?: number; tax?: number; detail?: Record<string, unknown> }
	) => {
		const [run] = await db
			.insert(payrollRuns)
			.values({ organizationId: org, cutoffStart: `${payDate.slice(0, 7)}-01`, cutoffEnd: payDate, payDate, frequency: 'monthly', dayFactor: 313 })
			.returning({ id: payrollRuns.id });
		runIds.push(run!.id);
		const [batch] = await db
			.insert(payrollBatches)
			.values({ runId: run!.id, establishmentId: est, status, generatedAt: new Date() })
			.returning({ id: payrollBatches.id });
		await db.insert(payrollRunLines).values({
			runId: run!.id,
			batchId: batch!.id,
			employeeId,
			establishmentId: est,
			personRef: mintRef('person'),
			employeeNo: 'X',
			employeeName: 'Test, X',
			position: 'Tester',
			payBasis: 'monthly',
			baseRateCentavos: 10_000_000,
			earnings: { basic: o.gross },
			grossCentavos: o.gross,
			deductions: { sss_ee: o.sss ?? 0, philhealth_ee: 0, pagibig_ee: 0, withholding_tax: o.tax ?? 0 },
			employerContributions: { sss_er: (o.sss ?? 0) * 2, ecc: 3_000, philhealth_er: 0, pagibig_er: 0 },
			detail: o.detail ?? {},
			netPayCentavos: o.gross - (o.sss ?? 0) - (o.tax ?? 0)
		});
	};
	const params = (over: Record<string, unknown> = {}) => ({
		asOf: '2034-06-30', fromMonth: '2034-06', toMonth: '2034-06', from: `${YEAR}-01-01`, to: `${YEAR}-12-31`, year: YEAR, est: '', drafts: false, ...over
	});

	beforeAll(async () => {
		org = await testOrgId();
		const [e] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: tag, name: 'Extra reports', orgRef: mintRef('org') })
			.returning({ id: establishments.id });
		est = e!.id;
		ana = await createTestStaff(est, { employeeNo: 'XR1', firstName: 'Ana', hiredOn: '2020-01-01' });
		ben = await createTestStaff(est, { employeeNo: 'XR2', firstName: 'Ben', hiredOn: '2020-01-01' });
		await db.update(employees).set({ govIds: { tin: '111-111-111-000', sss: '33-1', philhealth: '22', pagibig: '44' }, address: '1 Main St' }).where(eq(employees.id, ana));
		await slip(ana, `${YEAR}-05-31`, 'released', { gross: peso(100_000), sss: peso(1_000), tax: peso(10_000), detail: { nonTaxableCentavos: peso(2_000) } });
		await slip(ana, `${YEAR}-06-30`, 'released', { gross: peso(130_000), sss: peso(1_000), tax: peso(14_000), detail: { nonTaxableCentavos: peso(2_000) } });
		await slip(ben, `${YEAR}-06-30`, 'released', {
			gross: peso(50_000), sss: peso(500), tax: peso(2_000), detail: { annualTaxAdjustmentCentavos: -peso(1_000) }
		});
	});
	afterAll(async () => {
		if (runIds.length) await db.delete(payrollRuns).where(inArray(payrollRuns.id, runIds));
		await cleanupTestEstablishments([est]);
	});

	it('completeness lists what is missing, only where the agency applies, and skips complete people', async () => {
		const d = await X.dataCompletenessDoc(org, params({ est }));
		const rows = d.sections[0]!.rows;
		expect(rows.map((r) => r[1])).toEqual(['Test, Ben']);
		expect(String(rows[0]![5])).toContain('TIN');
		expect(String(rows[0]![5])).toContain('Address');
		expect(d.stats.find((s) => s.label === 'People checked')!.value).toBe('2');
		expect(d.stats.find((s) => s.label === 'With gaps')!.value).toBe('1');
	});

	it('contributions add up per person for the year, with EC apart from the employer share', async () => {
		const d = await X.contributionsYtdDoc(org, params());
		const row = d.sections[0]!.rows.find((r) => r[1] === 'Test, Ana')!;
		expect(row[3]).toBe(peso(2_000)); // SSS EE, two months
		expect(row[4]).toBe(peso(4_000)); // SSS ER
		expect(row[5]).toBe(6_000); // EC
	});

	it('variance compares with the month before and flags a jump and a new person', async () => {
		const d = await X.payrollVarianceDoc(org, params());
		const rows = d.sections[0]!.rows;
		const ana = rows.find((r) => r[1] === 'Test, Ana')!;
		expect(ana[2]).toBe(peso(100_000));
		expect(ana[3]).toBe(peso(130_000));
		expect(ana[4]).toBe(peso(30_000));
		expect(ana[5]).toBe('+30.0%');
		expect(ana[7]).toBe('Check');
		expect(rows.find((r) => r[1] === 'Test, Ben')![7]).toBe('New this month');
	});

	it('1601-C gives each month, nets tax returned off what is remitted, and shows no-payroll months', async () => {
		const d = await X.bir1601cDoc(org, params(), '2034-07-15');
		const rows = d.sections[0]!.rows;
		const may = rows.find((r) => String(r[0]).startsWith('May'))!;
		expect(may[2]).toBe(peso(100_000));
		expect(may[5]).toBe(peso(10_000));
		expect(may[7]).toBe(peso(10_000));
		const june = rows.find((r) => String(r[0]).startsWith('June'))!;
		expect(june[1]).toBe(2);
		expect(june[5]).toBe(peso(14_000 + 2_000));
		expect(june[6]).toBe(peso(1_000));
		expect(june[7]).toBe(peso(14_000 + 2_000 - 1_000));
		expect(rows.find((r) => String(r[0]).startsWith('March'))![9]).toBe('No payroll');
		const total = rows[rows.length - 1]!;
		expect(total[7]).toBe(peso(10_000 + 16_000 - 1_000));
	});

	it('loans outstanding builds without loans and returns a stats row', async () => {
		const d = await X.loansOutstandingDoc(org, params());
		expect(d.stats.find((s) => s.label === 'Open loans')).toBeTruthy();
		expect(Array.isArray(d.sections[0]!.rows)).toBe(true);
	});
});
