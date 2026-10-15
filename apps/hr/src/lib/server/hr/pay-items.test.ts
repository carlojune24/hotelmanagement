import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';
import { appliesToCutoff, bucketsOf, itemisedRows } from '$lib/pay-items-core';

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
			otherDeductionsCentavos: 15_000,
			nonTaxableEarningsCentavos: 0
		});
	});

	it('tracks the exempt part of the earnings, and never for a deduction', () => {
		const b = bucketsOf([
			{ kind: 'earning', category: 'allowance', amountCentavos: 50_000, taxable: false },
			{ kind: 'earning', category: 'incentive', amountCentavos: 100_000 },
			{ kind: 'deduction', category: 'other', amountCentavos: 15_000, taxable: false }
		]);
		expect(b.nonTaxableEarningsCentavos).toBe(50_000);
		expect(b.allowancesCentavos).toBe(50_000);
		expect(b.otherEarningsCentavos).toBe(100_000);
	});

	it('itemises a payslip bucket by name and keeps any unexplained remainder under the bucket label', () => {
		const items = [
			{ label: 'Sales incentive', amountCentavos: 100_000 },
			{ label: 'Perfect attendance', amountCentavos: 50_000 }
		];
		expect(itemisedRows(items, 150_000, 'Other earnings')).toEqual([
			['Sales incentive', 100_000],
			['Perfect attendance', 50_000]
		]);
		expect(itemisedRows(items, 175_000, 'Other earnings')).toEqual([
			['Sales incentive', 100_000],
			['Perfect attendance', 50_000],
			['Other earnings', 25_000]
		]);
		expect(itemisedRows([], 20_000, 'Cash advance')).toEqual([['Cash advance', 20_000]]);
		expect(itemisedRows([], 0, 'Cash advance')).toEqual([]);
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

	it('edits an item in place and the draft payslip follows', async () => {
		const item = (await PI.listPayItems(org)).find((r) => r.label === 'Rice allowance')!;
		expect(item.lockReason).toBeNull();
		const before = await lineOf();
		const r = await PI.updatePayItem(
			org,
			PI.payItemEditSchema.parse({
				id: item.id, category: 'allowance', label: 'Rice allowance (raised)', amount: 800, exempt: true,
				recurring: false, startDate: '2031-05-04', endDate: '', note: 'raised'
			})
		);
		expect(r.after.amountCentavos).toBe(80_000);
		expect(r.after.taxable).toBe(false);
		const after = await lineOf();
		expect(after.grossCentavos).toBe(before.grossCentavos + 30_000);
		expect((after.earnings as { allowances: number }).allowances).toBe(80_000);
		expect((after.detail as { nonTaxableCentavos: number }).nonTaxableCentavos).toBe(80_000);
	});

	it('refuses to edit a voided item, a wrong type for its kind, or an end before the start', async () => {
		const voided = (await PI.listPayItems(org)).find((r) => r.status === 'voided')!;
		const edit = (over: Record<string, unknown>) =>
			PI.payItemEditSchema.parse({ id: voided.id, category: 'other', label: 'x', amount: 1, recurring: false, exempt: false, startDate: '2031-05-04', endDate: '', note: '', ...over });
		await expect(PI.updatePayItem(org, edit({}))).rejects.toThrow(/voided/);
		const live = (await PI.listPayItems(org)).find((r) => r.label === 'Cash advance')!;
		await expect(PI.updatePayItem(org, edit({ id: live.id, category: 'allowance' }))).rejects.toThrow(/does not fit/);
		expect(() => edit({ recurring: true, startDate: '2031-05-10', endDate: '2031-05-01' })).toThrow(/before the start/);
	});

	it('archives an item so payroll stops picking it up, and restores it', async () => {
		const item = (await PI.listPayItems(org)).find((r) => r.label === 'Uniform')!;
		const before = await lineOf();
		await PI.archivePayItem(org, item.id, true);
		const after = await lineOf();
		expect(after.grossCentavos).toBe(before.grossCentavos);
		expect((after.deductions as { other: number }).other).toBe(0);
		expect((await PI.listPayItems(org)).find((r) => r.id === item.id)!.status).toBe('archived');
		await expect(PI.archivePayItem(org, item.id, true)).rejects.toThrow(/already archived/);
		await expect(PI.updatePayItem(org, PI.payItemEditSchema.parse({
			id: item.id, category: 'other', label: 'Uniform', amount: 150, recurring: false, exempt: false, startDate: '2031-05-04', endDate: '', note: ''
		}))).rejects.toThrow(/Restore/);
		// A regenerate leaves it out too.
		await P.generateBatch(batch);
		expect(((await lineOf()).deductions as { other: number }).other).toBe(0);
		await PI.archivePayItem(org, item.id, false);
		expect(((await lineOf()).deductions as { other: number }).other).toBe(15_000);
		await expect(PI.archivePayItem(org, item.id, false)).rejects.toThrow(/not archived/);
	});

	it('once the batch is locked an applied item is locked: no edit, no void, no archive, no new item for that cutoff', async () => {
		await P.acknowledgeRates(runId, null);
		await P.lockBatch(batch, null);
		const locked = await lineOf();
		await expect(
			PI.createPayItems(org, PI.payItemSchema.parse({ ...base, kind: 'earning', category: 'incentive', label: 'Too late', amount: 777, startDate: '2031-05-04' }), null)
		).rejects.toThrow(/already locked.*still open/);
		expect((await lineOf()).grossCentavos).toBe(locked.grossCentavos);
		const applied = (await PI.listPayItems(org)).find((r) => r.label === 'Rice allowance (raised)')!;
		expect(applied.status).toBe('locked');
		expect(applied.lockReason).toMatch(/already locked/);
		const edit = PI.payItemEditSchema.parse({
			id: applied.id, category: 'allowance', label: 'Changed', amount: 1, recurring: false, exempt: false, startDate: '2031-05-04', endDate: '', note: ''
		});
		await expect(PI.updatePayItem(org, edit)).rejects.toThrow(/locked/);
		await expect(PI.voidPayItem(applied.id, '')).rejects.toThrow(/locked/);
		await expect(PI.archivePayItem(org, applied.id, true)).rejects.toThrow(/locked/);
	});

	it('an item not linked to a payslip is still locked when its cutoff has been processed', async () => {
		// "Later" was filed for 2031-05-20, outside the processed cutoff, so it is still free.
		const later = (await PI.listPayItems(org)).find((r) => r.label === 'Later')!;
		expect(later.lockReason).toBeNull();
		// Moving it into the processed cutoff would leave it unpaid for good, so it is refused.
		await expect(
			PI.updatePayItem(org, PI.payItemEditSchema.parse({
				id: later.id, category: 'allowance', label: 'Later', amount: 999, recurring: false, exempt: false, startDate: '2031-05-04', endDate: '', note: ''
			}))
		).rejects.toThrow(/already locked.*still open/);
		// But it can still move to another open cutoff.
		const ok = await PI.updatePayItem(org, PI.payItemEditSchema.parse({
			id: later.id, category: 'allowance', label: 'Later', amount: 999, recurring: false, exempt: false, startDate: '2031-06-20', endDate: '', note: ''
		}));
		expect(ok.after.startDate).toBe('2031-06-20');
	});

	it('a recurring item that has been paid cannot be edited but can be archived to end it', async () => {
		const monthly = (await PI.listPayItems(org)).find((r) => r.label === 'Monthly bonus')!;
		expect(monthly.recurring).toBe(true);
		expect(monthly.lockReason).toMatch(/Archive it/);
		await PI.archivePayItem(org, monthly.id, true);
		expect((await PI.listPayItems(org)).find((r) => r.id === monthly.id)!.status).toBe('archived');
	});
});
