import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';
import { appliesToCutoff, bucketsOf } from '$lib/pay-items-core';

describe('pay item rules', () => {
	it('sorts items into the four payroll buckets', () => {
		const b = bucketsOf([
			{ kind: 'earning', category: 'allowance', amountCentavos: 50_000 },
			{ kind: 'earning', category: 'incentive', amountCentavos: 100_000 },
			{ kind: 'earning', category: 'other', amountCentavos: 25_000 },
			{ kind: 'deduction', category: 'cash_advance', amountCentavos: 20_000 },
			{ kind: 'deduction', category: 'other', amountCentavos: 15_000 }
		]);
		expect(b).toEqual({
			allowancesCentavos: 50_000,
			otherEarningsCentavos: 125_000,
			cashAdvanceCentavos: 20_000,
			otherDeductionsCentavos: 15_000
		});
	});

	it('applies a single-cutoff item only to the cutoff holding its date, and a recurring one across its span', () => {
		const one = { startDate: '2031-05-04', endDate: '2031-05-04' };
		expect(appliesToCutoff(one, '2031-05-01', '2031-05-15')).toBe(true);
		expect(appliesToCutoff(one, '2031-05-16', '2031-05-31')).toBe(false);
		const open = { startDate: '2031-04-01', endDate: null };
		expect(appliesToCutoff(open, '2031-05-16', '2031-05-31')).toBe(true);
		expect(appliesToCutoff({ startDate: '2031-04-01', endDate: '2031-04-30' }, '2031-05-01', '2031-05-15')).toBe(false);
	});
});

/**
 * Live-DB: pay items reach a payslip and its calculation. Far-future month so it never collides with other
 * payroll data in the dev database.
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

describe.skipIf(!hasDb)('pay items in payroll (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { dtrEntries, dtrSubmissions, establishments, organizations, payItems, payrollRuns, schedules } = await import(
		'$lib/server/db/schema/index'
	);
	const { mintRef } = await import('$lib/server/ids');
	const { eq } = await import('drizzle-orm');
	const P = await import('./payroll');
	const PI = await import('./pay-items');

	const tag = `pitest-${Math.random().toString(36).slice(2, 10)}`;
	let org = '';
	let est = '';
	let ana = '';
	let runId = '';
	let batch = '';
	let originalConfig: unknown = {};

	const lineOf = async () => (await P.listBatchLines(batch)).find((l) => l.employeeId === ana)!;
	const sum = (o: unknown) => Object.values(o as Record<string, number>).reduce((a, b) => a + b, 0);
	const base = {
		employeeIds: [] as string[],
		recurring: false,
		endDate: null,
		note: ''
	};

	beforeAll(async () => {
		org = await testOrgId();
		const o = await db.select({ c: organizations.config }).from(organizations).where(eq(organizations.id, org));
		originalConfig = o[0]!.c;
		await P.saveDayFactor(org, 313);
		const [e] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: tag, name: 'Pay items test', orgRef: mintRef('org') })
			.returning({ id: establishments.id });
		est = e!.id;
		ana = await createTestStaff(est, { employeeNo: 'PI1', firstName: 'Ana' });
		base.employeeIds = [ana];
		for (const date of ['2031-05-02', '2031-05-03', '2031-05-05', '2031-05-06']) {
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
		}
		await db.insert(dtrSubmissions).values({ establishmentId: est, cutoffStart: '2031-05-01', cutoffEnd: '2031-05-31', status: 'received' });
		const run = await P.createRun(org, { cutoffStart: '2031-05-01', cutoffEnd: '2031-05-15', payDate: '2031-05-20', frequency: 'semi_monthly' }, null);
		runId = run.id;
		batch = (await P.getRun(runId)).batches.find((b) => b.establishmentId === est)!.id;
		await P.generateBatch(batch);
	});

	afterAll(async () => {
		if (ana) await db.delete(payItems).where(eq(payItems.employeeId, ana));
		if (runId) await db.delete(payrollRuns).where(eq(payrollRuns.id, runId));
		await cleanupTestEstablishments([est]);
		await db.update(organizations).set({ config: originalConfig as object }).where(eq(organizations.id, org));
	});

	let g0 = 0;
	let net0 = 0;
	let tax0 = 0;
	let incentiveId = '';

	it('an item filed for the cutoff lands on the draft payslip and moves gross, deductions and net', async () => {
		const before = await lineOf();
		g0 = before.grossCentavos;
		net0 = before.netPayCentavos;
		tax0 = (before.deductions as { withholding_tax: number }).withholding_tax;

		const mk = (kind: 'earning' | 'deduction', category: 'allowance' | 'incentive' | 'cash_advance' | 'other', label: string, amount: number) =>
			PI.createPayItems(org, PI.payItemSchema.parse({ ...base, kind, category, label, amount, startDate: '2031-05-04' }), null);
		await mk('earning', 'allowance', 'Rice allowance', 500);
		const inc = await mk('earning', 'incentive', 'Sales incentive', 1000);
		incentiveId = inc.created[0]!.id;
		await mk('deduction', 'cash_advance', 'Cash advance', 200);
		await mk('deduction', 'other', 'Uniform', 150);

		const after = await lineOf();
		const e = after.earnings as Record<string, number>;
		const d = after.deductions as Record<string, number>;
		expect(e.allowances).toBe(50_000);
		expect(e.other).toBe(100_000);
		expect(d.cash_advance).toBe(20_000);
		expect(d.other).toBe(15_000);
		expect(after.grossCentavos).toBe(g0 + 150_000);
		// Net is gross less every deduction, withholding tax included.
		expect(after.netPayCentavos).toBe(after.grossCentavos - sum(after.deductions));
		expect(after.netPayCentavos).toBe(net0 + 150_000 - 20_000 - 15_000 - (d.withholding_tax! - tax0));
		expect((after.detail as { payItems: unknown[] }).payItems).toHaveLength(4);
		const rows = await PI.listPayItems(org);
		expect(rows.filter((r) => r.employeeId === ana && r.status === 'draft')).toHaveLength(4);
	});

	it('a regenerate rebuilds the same figures from the items', async () => {
		const before = await lineOf();
		await P.generateBatch(batch);
		const again = await lineOf();
		expect(again.grossCentavos).toBe(before.grossCentavos);
		expect(again.netPayCentavos).toBe(before.netPayCentavos);
		expect((again.detail as { payItems: unknown[] }).payItems).toHaveLength(4);
	});

	it('an item for another cutoff waits; a recurring one applies to this cutoff', async () => {
		const before = await lineOf();
		await PI.createPayItems(org, PI.payItemSchema.parse({ ...base, kind: 'earning', category: 'allowance', label: 'Later', amount: 999, startDate: '2031-05-20' }), null);
		expect((await lineOf()).grossCentavos).toBe(before.grossCentavos);
		const later = (await PI.listPayItems(org)).find((r) => r.label === 'Later')!;
		expect(later.status).toBe('pending');

		await PI.createPayItems(
			org,
			PI.payItemSchema.parse({ ...base, kind: 'earning', category: 'other', label: 'Monthly bonus', amount: 300, recurring: true, startDate: '2031-04-01' }),
			null
		);
		const after = await lineOf();
		expect(after.grossCentavos).toBe(before.grossCentavos + 30_000);
	});

	it('a large incentive raises withholding tax; voiding it brings everything back', async () => {
		const before = await lineOf();
		const taxBefore = (before.deductions as { withholding_tax: number }).withholding_tax;
		const [r] = (
			await PI.createPayItems(org, PI.payItemSchema.parse({ ...base, kind: 'earning', category: 'incentive', label: 'Big incentive', amount: 40_000, startDate: '2031-05-04' }), null)
		).created;
		const big = await lineOf();
		expect((big.deductions as { withholding_tax: number }).withholding_tax).toBeGreaterThan(taxBefore);
		expect(big.netPayCentavos).toBe(big.grossCentavos - sum(big.deductions));

		await PI.voidPayItem(r!.id, 'entered by mistake');
		const back = await lineOf();
		expect(back.grossCentavos).toBe(before.grossCentavos);
		expect(back.netPayCentavos).toBe(before.netPayCentavos);
	});

	it('voiding an item removes it from the payslip', async () => {
		const before = await lineOf();
		await PI.voidPayItem(incentiveId, '');
		const after = await lineOf();
		expect(after.grossCentavos).toBe(before.grossCentavos - 100_000);
		expect((after.detail as { payItems: unknown[] }).payItems).toHaveLength(4); // allowance, advance, uniform, monthly bonus
		await expect(PI.voidPayItem(incentiveId, '')).rejects.toThrow(/already voided/);
	});

	it('once the batch is locked a new item no longer changes it, and an applied item cannot be voided', async () => {
		await P.acknowledgeRates(runId, null);
		await P.lockBatch(batch, null);
		const locked = await lineOf();
		await PI.createPayItems(org, PI.payItemSchema.parse({ ...base, kind: 'earning', category: 'incentive', label: 'Too late', amount: 777, startDate: '2031-05-04' }), null);
		expect((await lineOf()).grossCentavos).toBe(locked.grossCentavos);
		const applied = (await PI.listPayItems(org)).find((r) => r.label === 'Rice allowance')!;
		expect(applied.status).toBe('locked');
		await expect(PI.voidPayItem(applied.id, '')).rejects.toThrow(/locked/);
	});
});
