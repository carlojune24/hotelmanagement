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

/**
 * Every shape of year the annualization has to survive. Each scenario owns its own people so they cannot
 * affect one another; the year (2033) is far from any real data in the shared test organization.
 */
describe.skipIf(!live)('year-end annualization scenarios (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { employees, establishments, payrollBatches, payrollRunLines, payrollRuns, separationItems, separations } = await import(
		'$lib/server/db/schema/index'
	);
	const { mintRef } = await import('$lib/server/ids');
	const { eq, inArray } = await import('drizzle-orm');
	const { annualTaxDue, computeWithholdingTax } = await import('@mm/hr-core');
	const A = await import('./annualization');
	const B = await import('./bonuses');
	const S = await import('./separations');
	const P = await import('./payroll');

	const YEAR = 2033;
	const tag = `annualscn-${Math.random().toString(36).slice(2, 10)}`;
	let org = '';
	let est = '';
	const runIds: string[] = [];
	const sepIds: string[] = [];
	const staff: Record<string, string> = {};
	let n = 0;

	type Ded = Partial<Record<'sss_ee' | 'philhealth_ee' | 'pagibig_ee' | 'withholding_tax', number>>;
	const who = async (name: string, extra: Partial<typeof employees.$inferInsert> = {}) => {
		n += 1;
		const id = await createTestStaff(est, { employeeNo: `S${n}`, firstName: name, hiredOn: '2020-01-01' });
		if (Object.keys(extra).length) await db.update(employees).set(extra).where(eq(employees.id, id));
		staff[name] = id;
		return id;
	};
	const slip = async (
		employeeId: string,
		payDate: string,
		status: 'released' | 'locked' | 'draft',
		o: { gross: number; ded?: Ded; detail?: Record<string, unknown>; other?: number } = { gross: 0 }
	) => {
		const [run] = await db
			.insert(payrollRuns)
			.values({ organizationId: org, cutoffStart: `${payDate.slice(0, 7)}-01`, cutoffEnd: payDate, payDate, frequency: 'semi_monthly', dayFactor: 313 })
			.returning({ id: payrollRuns.id });
		runIds.push(run!.id);
		const [batch] = await db
			.insert(payrollBatches)
			.values({ runId: run!.id, establishmentId: est, status, generatedAt: new Date() })
			.returning({ id: payrollBatches.id });
		const ded = { sss_ee: 0, philhealth_ee: 0, pagibig_ee: 0, withholding_tax: 0, cash_advance: 0, loans: 0, tardiness_undertime: 0, other: 0, ...(o.ded ?? {}) };
		const [line] = await db
			.insert(payrollRunLines)
			.values({
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
				earnings: { basic: o.gross - (o.other ?? 0), overtime: 0, holiday_premium: 0, night_diff: 0, allowances: 0, other: o.other ?? 0 },
				grossCentavos: o.gross,
				deductions: ded,
				employerContributions: {},
				detail: o.detail ?? {},
				netPayCentavos: o.gross - Object.values(ded).reduce((a, b) => a + b, 0)
			})
			.returning({ id: payrollRunLines.id });
		return { batchId: batch!.id, lineId: line!.id };
	};
	const row = async (id: string, target: { batchId: string } | null = null) =>
		(await A.annualizationRows(org, YEAR, target)).find((r) => r.employeeId === id);
	const peso = (x: number) => Math.round(x * 100);

	beforeAll(async () => {
		org = await testOrgId();
		const [e] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: tag, name: 'Annual scenarios', orgRef: mintRef('org') })
			.returning({ id: establishments.id });
		est = e!.id;
	});
	afterAll(async () => {
		const bb = await db.query?.bonusBatches?.findMany?.({ where: (t, { eq: e }) => e(t.establishmentId, est) }).catch(() => []);
		void bb;
		const { bonusBatches, bonusLines } = await import('$lib/server/db/schema/index');
		const batches = await db.select({ id: bonusBatches.id }).from(bonusBatches).where(eq(bonusBatches.establishmentId, est));
		const ids = batches.map((b) => b.id);
		if (ids.length) {
			await db.delete(bonusLines).where(inArray(bonusLines.batchId, ids));
			await db.delete(bonusBatches).where(inArray(bonusBatches.id, ids));
		}
		if (sepIds.length) {
			await db.delete(separationItems).where(inArray(separationItems.separationId, sepIds));
			const { separationClearance } = await import('$lib/server/db/schema/index');
			await db.delete(separationClearance).where(inArray(separationClearance.separationId, sepIds));
			await db.delete(separations).where(inArray(separations.id, sepIds));
		}
		if (runIds.length) await db.delete(payrollRuns).where(inArray(payrollRuns.id, runIds));
		await cleanupTestEstablishments([est]);
	});

	describe('who appears', () => {
		it('omits a person with no payslip in the year, and one whose payslips are all drafts', async () => {
			const none = await who('NoSlip');
			const draftOnly = await who('DraftOnly');
			await slip(draftOnly, `${YEAR}-03-15`, 'draft', { gross: peso(20_000) });
			expect(await row(none)).toBeUndefined();
			expect(await row(draftOnly)).toBeUndefined();
		});

		it('counts locked and released the same, and a draft only as the chosen target', async () => {
			const id = await who('LockedAndReleased');
			await slip(id, `${YEAR}-02-15`, 'locked', { gross: peso(10_000) });
			await slip(id, `${YEAR}-03-15`, 'released', { gross: peso(10_000) });
			const d = await slip(id, `${YEAR}-04-15`, 'draft', { gross: peso(10_000) });
			expect((await row(id))!.gross).toBe(peso(20_000));
			expect((await row(id, { batchId: d.batchId }))!.gross).toBe(peso(30_000));
		});

		it('uses the pay date year: a payslip paid January 1 of next year is not this year', async () => {
			const id = await who('YearEdge');
			await slip(id, `${YEAR}-12-31`, 'released', { gross: peso(10_000) });
			await slip(id, `${YEAR + 1}-01-01`, 'released', { gross: peso(10_000) });
			const r = (await row(id))!;
			expect(r.payslips).toBe(1);
			expect(r.gross).toBe(peso(10_000));
		});

		it('keeps people apart: one person\'s pay never leaks into another', async () => {
			const a = await who('Alone1');
			const b = await who('Alone2');
			await slip(a, `${YEAR}-05-15`, 'released', { gross: peso(10_000) });
			await slip(b, `${YEAR}-05-15`, 'released', { gross: peso(70_000) });
			expect((await row(a))!.gross).toBe(peso(10_000));
			expect((await row(b))!.gross).toBe(peso(70_000));
		});

		it('includes someone with only a previous-employer figure for the year', async () => {
			const id = await who('PrevOnly', { prevEmployerYear: YEAR, prevEmployerTaxableCentavos: peso(100_000), prevEmployerWithheldCentavos: 0 });
			const r = (await row(id))!;
			expect(r.payslips).toBe(0);
			expect(r.prevTaxable).toBe(peso(100_000));
		});
	});

	describe('taxable pay', () => {
		it('is gross less exempt earnings and the three contributions', async () => {
			const id = await who('Taxable');
			await slip(id, `${YEAR}-06-15`, 'released', {
				gross: peso(100_000),
				ded: { sss_ee: peso(1_000), philhealth_ee: peso(500), pagibig_ee: peso(200) },
				detail: { nonTaxableCentavos: peso(5_000) }
			});
			const r = (await row(id))!;
			expect(r.contributions).toBe(peso(1_700));
			expect(r.exemptEarnings).toBe(peso(5_000));
			expect(r.taxable).toBe(peso(100_000 - 5_000 - 1_700));
		});

		it('never goes below zero', async () => {
			const id = await who('Floor');
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(1_000), ded: { sss_ee: peso(900), philhealth_ee: peso(900) } });
			expect((await row(id))!.taxable).toBe(0);
		});

		it('a legacy payslip with no tax detail is simply all taxable', async () => {
			const id = await who('Legacy');
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(50_000), detail: {} });
			const r = (await row(id))!;
			expect(r.exemptEarnings).toBe(0);
			expect(r.taxable).toBe(peso(50_000));
		});
	});

	describe('tax due across the brackets', () => {
		const cases: Array<[string, number]> = [
			['under the zero bracket', 200_000],
			['exactly 250,000', 250_000],
			['in the 20% bracket', 600_000],
			['in the 25% bracket', 1_500_000],
			['in the 30% bracket', 5_000_000],
			['in the 35% bracket', 9_000_000]
		];
		for (const [label, income] of cases) {
			it(`${label}: ${income.toLocaleString()}`, async () => {
				const id = await who(`Bracket${income}`);
				await slip(id, `${YEAR}-07-15`, 'released', { gross: peso(income) });
				const r = (await row(id))!;
				expect(r.taxDue).toBe(annualTaxDue(peso(income)));
			});
		}
	});

	describe('settlement', () => {
		it('under-withheld: positive settlement equals tax due minus withheld', async () => {
			const id = await who('Under');
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(600_000), ded: { withholding_tax: peso(1_000) } });
			const r = (await row(id))!;
			expect(r.settlement).toBe(annualTaxDue(peso(600_000)) - peso(1_000));
			expect(r.settlement).toBeGreaterThan(0);
		});

		it('exactly withheld: zero settlement', async () => {
			const id = await who('Exact');
			const due = annualTaxDue(peso(400_000));
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(400_000), ded: { withholding_tax: due } });
			expect((await row(id))!.settlement).toBe(0);
		});

		it('over-withheld: negative settlement is a refund', async () => {
			const id = await who('Over');
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(200_000), ded: { withholding_tax: peso(9_000) } });
			expect((await row(id))!.settlement).toBe(-peso(9_000));
		});

		it('withholding by a previous employer counts toward what was withheld', async () => {
			const id = await who('PrevWithheld', { prevEmployerYear: YEAR, prevEmployerTaxableCentavos: peso(200_000), prevEmployerWithheldCentavos: peso(7_500) });
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(200_000), ded: { withholding_tax: 0 } });
			const r = (await row(id))!;
			expect(r.taxable).toBe(peso(400_000));
			expect(r.settlement).toBe(annualTaxDue(peso(400_000)) - peso(7_500));
		});

		it('ignores a previous employer recorded for a different year', async () => {
			const id = await who('PrevOtherYear', { prevEmployerYear: YEAR - 1, prevEmployerTaxableCentavos: peso(900_000), prevEmployerWithheldCentavos: peso(50_000) });
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(100_000) });
			const r = (await row(id))!;
			expect(r.prevTaxable).toBe(0);
			expect(r.prevWithheld).toBe(0);
			expect(r.taxable).toBe(peso(100_000));
		});

		it('a withholding-exempt person owes nothing, so everything withheld is returned', async () => {
			const id = await who('MinWage', { withholdingExempt: true });
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(500_000), ded: { withholding_tax: peso(2_000) } });
			const r = (await row(id))!;
			expect(r.taxDue).toBe(0);
			expect(r.settlement).toBe(-peso(2_000));
		});

		it('a refund or extra already settled in a final batch is not settled twice', async () => {
			const id = await who('Settled');
			const due = annualTaxDue(peso(300_000));
			// 300,000 earned, withheld nothing during the year, then a December settlement of the full due.
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(300_000) });
			await slip(id, `${YEAR}-12-15`, 'released', {
				gross: 0,
				ded: { withholding_tax: due },
				detail: { annualTaxAdjustmentCentavos: due }
			});
			expect((await row(id))!.settlement).toBe(0);
		});

		it('a refund paid in a final batch is taken out of income and withheld totals', async () => {
			const id = await who('Refunded');
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(200_000), ded: { withholding_tax: peso(9_000) } });
			await slip(id, `${YEAR}-12-15`, 'released', {
				gross: peso(9_000),
				other: peso(9_000),
				detail: { nonTaxableCentavos: peso(9_000), annualTaxAdjustmentCentavos: -peso(9_000) }
			});
			const r = (await row(id))!;
			expect(r.taxable).toBe(peso(200_000));
			expect(r.settlement).toBe(0);
		});
	});

	describe('13th month and other benefits', () => {
		const issue = async (id: string, amountPesos: number, label: string) => {
			const out = await B.createBatches(org, { kind: 'other', year: YEAR, establishmentId: est, label, defaultAmount: 0 }, null);
			const batchId = out.created[0]!;
			const view = (await B.listBatches(org, YEAR)).find((b) => b.id === batchId)!;
			const line = view.lines.find((l) => l.employeeId === id)!;
			await B.setLineAmount(org, line.id, amountPesos);
			return { batchId, issue: () => B.issueBatch(org, batchId, null) };
		};

		it('benefits up to ₱90,000 are fully exempt', async () => {
			const id = await who('BenefitsLow');
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(100_000) });
			await (await issue(id, 60_000, 'Low bonus')).issue();
			const r = (await row(id))!;
			expect(r.benefits).toBe(peso(60_000));
			expect(r.benefitsTaxable).toBe(0);
			expect(r.taxable).toBe(peso(100_000));
		});

		it('only the part above ₱90,000 is taxable', async () => {
			const id = await who('BenefitsHigh');
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(100_000) });
			await (await issue(id, 130_000, 'High bonus')).issue();
			const r = (await row(id))!;
			expect(r.benefitsExempt).toBe(peso(90_000));
			expect(r.benefitsTaxable).toBe(peso(40_000));
			expect(r.taxable).toBe(peso(140_000));
		});

		it('a draft bonus batch is not counted', async () => {
			const id = await who('BenefitsDraft');
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(100_000) });
			await issue(id, 120_000, 'Draft bonus'); // never issued
			const r = (await row(id))!;
			expect(r.benefits).toBe(0);
			expect(r.taxable).toBe(peso(100_000));
		});

		it('two issued bonuses are summed against one ₱90,000 exemption', async () => {
			const id = await who('BenefitsTwo');
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(100_000) });
			await (await issue(id, 50_000, 'First')).issue();
			await (await issue(id, 50_000, 'Second')).issue();
			const r = (await row(id))!;
			expect(r.benefits).toBe(peso(100_000));
			expect(r.benefitsTaxable).toBe(peso(10_000));
		});

		it('13th month paid in final pay counts, a voided line does not', async () => {
			const id = await who('FinalPay');
			await slip(id, `${YEAR}-03-15`, 'released', { gross: peso(100_000) });
			const sep = await S.startSeparation(org, { employeeId: id, kind: 'resigned', lastDay: `${YEAR}-04-30` }, null);
			sepIds.push(sep.id);
			await db.insert(separationItems).values([
				{ separationId: sep.id, kind: 'credit', label: '13th month pay', amountCentavos: peso(20_000), source: 'thirteenth_month', sourceYear: YEAR },
				{ separationId: sep.id, kind: 'credit', label: '13th month pay (voided)', amountCentavos: peso(70_000), source: 'thirteenth_month', sourceYear: YEAR, voidedAt: new Date() }
			]);
			const r = (await row(id))!;
			expect(r.benefits).toBe(peso(20_000));
			expect(r.benefitsTaxable).toBe(0);
		});

		it('a 13th month recorded for another year is not this year', async () => {
			const id = await who('FinalPayOtherYear');
			await slip(id, `${YEAR}-03-15`, 'released', { gross: peso(100_000) });
			const sep = await S.startSeparation(org, { employeeId: id, kind: 'resigned', lastDay: `${YEAR}-04-30` }, null);
			sepIds.push(sep.id);
			await db.insert(separationItems).values({
				separationId: sep.id, kind: 'credit', label: '13th month pay', amountCentavos: peso(20_000), source: 'thirteenth_month', sourceYear: YEAR - 1
			});
			expect((await row(id))!.benefits).toBe(0);
		});
	});

	describe('applying the settlement', () => {
		const lineOf = (id: string) => db.select().from(payrollRunLines).where(eq(payrollRunLines.id, id)).then((r) => r[0]!);

		it('extra tax is added to withholding and net pay falls by it', async () => {
			const id = await who('ApplyExtra');
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(300_000), ded: { withholding_tax: 0 } });
			const reg = computeWithholdingTax(peso(30_000), 'semi_monthly');
			const d = await slip(id, `${YEAR}-12-15`, 'draft', { gross: peso(30_000), ded: { withholding_tax: reg } });
			const before = await lineOf(d.lineId);
			const r = (await row(id, { batchId: d.batchId }))!;
			expect(r.settlement).toBeGreaterThan(0);
			const out = await A.applyAnnualization(org, YEAR, d.batchId);
			expect(out.applied).toBeGreaterThanOrEqual(1);
			const after = await lineOf(d.lineId);
			expect((after.deductions as { withholding_tax: number }).withholding_tax).toBe(reg + r.settlement);
			expect(after.netPayCentavos).toBe(before.netPayCentavos - r.settlement);
			expect(after.grossCentavos).toBe(before.grossCentavos);
			// And the year is now settled.
			expect((await row(id, { batchId: d.batchId }))!.settlement).toBe(r.settlement);
		});

		it('a refund raises net pay and gross, and leaves withholding as computed', async () => {
			const id = await who('ApplyRefund');
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(100_000), ded: { withholding_tax: peso(10_000) } });
			const reg = computeWithholdingTax(peso(20_000), 'semi_monthly');
			const d = await slip(id, `${YEAR}-12-15`, 'draft', { gross: peso(20_000), ded: { withholding_tax: reg } });
			const r = (await row(id, { batchId: d.batchId }))!;
			expect(r.settlement).toBeLessThan(0);
			await A.applyAnnualization(org, YEAR, d.batchId);
			const after = await lineOf(d.lineId);
			expect(after.grossCentavos).toBe(peso(20_000) - r.settlement);
			expect((after.earnings as { other: number }).other).toBe(-r.settlement);
			expect((after.deductions as { withholding_tax: number }).withholding_tax).toBe(reg);
		});

		it('keeps a withholding override Main HR typed on the line', async () => {
			const id = await who('ApplyOverride');
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(100_000) });
			const d = await slip(id, `${YEAR}-12-15`, 'draft', { gross: peso(20_000) });
			await db.update(payrollRunLines).set({ adjustments: { withholdingOverrideCentavos: peso(777) } }).where(eq(payrollRunLines.id, d.lineId));
			await A.applyAnnualization(org, YEAR, d.batchId);
			const after = await lineOf(d.lineId);
			expect((after.deductions as { withholding_tax: number }).withholding_tax).toBeGreaterThanOrEqual(peso(777));
			expect((after.adjustments as { withholdingOverrideCentavos: number }).withholdingOverrideCentavos).toBe(peso(777));
		});

		it('a person with no line in the batch is reported, not silently skipped', async () => {
			const present = await who('InBatch');
			const absent = await who('NotInBatch');
			await slip(absent, `${YEAR}-06-15`, 'released', { gross: peso(600_000) });
			const d = await slip(present, `${YEAR}-12-15`, 'draft', { gross: peso(10_000) });
			const out = await A.applyAnnualization(org, YEAR, d.batchId);
			expect(out.missing.some((m) => m.includes('NotInBatch'))).toBe(true);
		});

		it('does not report a separated person as missing', async () => {
			const gone = await who('LeftAlready', { status: 'separated', separatedOn: `${YEAR}-05-31` });
			await slip(gone, `${YEAR}-05-15`, 'released', { gross: peso(600_000) });
			const d = await slip(await who('StillHere'), `${YEAR}-12-15`, 'draft', { gross: peso(10_000) });
			const out = await A.applyAnnualization(org, YEAR, d.batchId);
			expect(out.missing.some((m) => m.includes('LeftAlready'))).toBe(false);
		});

		it('refuses a locked batch, a batch from another year, and a batch of another organization', async () => {
			const id = await who('Refusals');
			const locked = await slip(id, `${YEAR}-12-15`, 'locked', { gross: peso(10_000) });
			await expect(A.applyAnnualization(org, YEAR, locked.batchId)).rejects.toThrow(/draft/);
			const draft = await slip(id, `${YEAR}-11-15`, 'draft', { gross: peso(10_000) });
			await expect(A.applyAnnualization(org, YEAR + 1, draft.batchId)).rejects.toThrow(/not paid in/);
			await expect(A.applyAnnualization('00000000-0000-4000-8000-000000000000', YEAR, draft.batchId)).rejects.toThrow(/does not exist/);
			await expect(A.applyAnnualization(org, YEAR, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(/does not exist/);
		});

		it('repeating is stable, and a changed income recomputes instead of stacking', async () => {
			const id = await who('Repeat');
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(300_000) });
			const d = await slip(id, `${YEAR}-12-15`, 'draft', { gross: peso(30_000) });
			await A.applyAnnualization(org, YEAR, d.batchId);
			const first = await lineOf(d.lineId);
			await A.applyAnnualization(org, YEAR, d.batchId);
			await A.applyAnnualization(org, YEAR, d.batchId);
			const third = await lineOf(d.lineId);
			expect(third.netPayCentavos).toBe(first.netPayCentavos);
			expect((third.detail as { annualTaxAdjustmentCentavos: number }).annualTaxAdjustmentCentavos).toBe(
				(first.detail as { annualTaxAdjustmentCentavos: number }).annualTaxAdjustmentCentavos
			);
			// More pay in the year → a bigger settlement, not the old one plus the new.
			await slip(id, `${YEAR}-09-15`, 'released', { gross: peso(300_000) });
			await A.applyAnnualization(org, YEAR, d.batchId);
			const fourth = await lineOf(d.lineId);
			const r = (await row(id, { batchId: d.batchId }))!;
			expect((fourth.detail as { annualTaxAdjustmentCentavos: number }).annualTaxAdjustmentCentavos).toBe(r.settlement);
		});

		it('adjusting a line afterwards (a pay item changing) keeps the settlement on it', async () => {
			const id = await who('AdjustAfter');
			await slip(id, `${YEAR}-06-15`, 'released', { gross: peso(300_000) });
			const d = await slip(id, `${YEAR}-12-15`, 'draft', { gross: peso(30_000) });
			await A.applyAnnualization(org, YEAR, d.batchId);
			const before = await lineOf(d.lineId);
			const adj = (before.detail as { annualTaxAdjustmentCentavos: number }).annualTaxAdjustmentCentavos;
			await P.adjustLine({ lineId: d.lineId, allowances: 100, withholdingOverride: null });
			const after = await lineOf(d.lineId);
			expect((after.detail as { annualTaxAdjustmentCentavos: number }).annualTaxAdjustmentCentavos).toBe(adj);
			expect(after.grossCentavos).toBe(before.grossCentavos + peso(100));
		});
	});

	describe('exempt pay items through adjustLine', () => {
		it('an exempt part is left out of taxable income and lowers withholding', async () => {
			const id = await who('ExemptItem');
			const d = await slip(id, `${YEAR}-10-15`, 'draft', { gross: peso(30_000), detail: { taxableCentavos: peso(30_000) } });
			await P.adjustLine({ lineId: d.lineId, allowances: 5_000, withholdingOverride: null });
			const taxableAll = ((await db.select().from(payrollRunLines).where(eq(payrollRunLines.id, d.lineId)))[0]!.detail as { taxableCentavos: number }).taxableCentavos;
			await P.adjustLine({ lineId: d.lineId, allowances: 5_000, nonTaxableEarnings: 5_000, withholdingOverride: null });
			const l = (await db.select().from(payrollRunLines).where(eq(payrollRunLines.id, d.lineId)))[0]!;
			const detail = l.detail as { taxableCentavos: number; nonTaxableCentavos: number };
			expect(detail.nonTaxableCentavos).toBe(peso(5_000));
			expect(detail.taxableCentavos).toBe(taxableAll - peso(5_000));
		});

		it('an exempt amount larger than gross cannot make taxable pay negative', async () => {
			const id = await who('ExemptTooBig');
			const d = await slip(id, `${YEAR}-10-16`, 'draft', { gross: peso(1_000) });
			await P.adjustLine({ lineId: d.lineId, allowances: 0, nonTaxableEarnings: 50_000, withholdingOverride: null });
			const l = (await db.select().from(payrollRunLines).where(eq(payrollRunLines.id, d.lineId)))[0]!;
			expect((l.detail as { taxableCentavos: number }).taxableCentavos).toBe(0);
			expect((l.deductions as { withholding_tax: number }).withholding_tax).toBe(0);
		});
	});
});
