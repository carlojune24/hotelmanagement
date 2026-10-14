import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payTermsFor, type Entry } from './salary';
import { cleanupTestEstablishments, createTestStaff, testOrgId } from './test-helpers';

const e = (effectiveFrom: string, rate: number, basis = 'monthly', prev?: { rate: number; basis: string }): Entry => ({
	effectiveFrom,
	payBasis: basis,
	baseRateCentavos: rate,
	previousRateCentavos: prev?.rate ?? null,
	previousPayBasis: prev?.basis ?? null
});
const fallback = e('2020-01-01', 1_000_000);

describe('which rate applies to a cutoff', () => {
	const history = [e('2024-01-01', 1_000_000), e('2026-10-16', 1_100_000, 'monthly', { rate: 1_000_000, basis: 'monthly' })];

	it('uses the single rate in force when nothing changes inside the cutoff', () => {
		const t = payTermsFor(history, '2026-10-01', '2026-10-15', fallback);
		expect(t).toMatchObject({ payBasis: 'monthly', baseRateCentavos: 1_000_000, segments: null, changes: [] });
		const after = payTermsFor(history, '2026-11-01', '2026-11-15', fallback);
		expect(after).toMatchObject({ baseRateCentavos: 1_100_000, segments: null });
	});

	it('splits a cutoff the day a rate changes, the new rate starting on the effective date', () => {
		const t = payTermsFor(history, '2026-10-16', '2026-10-31', fallback);
		// Effective on the cutoff's first day: no split, the whole cutoff is at the new rate.
		expect(t).toMatchObject({ baseRateCentavos: 1_100_000, segments: null });
		const mid = payTermsFor(
			[...history, e('2026-10-20', 1_300_000, 'monthly', { rate: 1_100_000, basis: 'monthly' })],
			'2026-10-16',
			'2026-10-31',
			fallback
		);
		expect(mid.segments).toEqual([
			{ start: '2026-10-16', end: '2026-10-19', baseRateCentavos: 1_100_000 },
			{ start: '2026-10-20', end: '2026-10-31', baseRateCentavos: 1_300_000 }
		]);
		expect(mid.baseRateCentavos).toBe(1_300_000);
		expect(mid.changes).toEqual([{ date: '2026-10-20', fromCentavos: 1_100_000, toCentavos: 1_300_000 }]);
	});

	it('keeps the old pay basis for the cutoff a change of basis lands in, and starts the new one next cutoff', () => {
		const h = [e('2024-01-01', 1_000_000), e('2026-10-10', 80_000, 'daily', { rate: 1_000_000, basis: 'monthly' })];
		const t = payTermsFor(h, '2026-10-01', '2026-10-15', fallback);
		expect(t).toMatchObject({ payBasis: 'monthly', baseRateCentavos: 1_000_000, segments: null, deferredBasisChange: '2026-10-10' });
		expect(payTermsFor(h, '2026-10-16', '2026-10-31', fallback)).toMatchObject({ payBasis: 'daily', baseRateCentavos: 80_000 });
	});

	it('knows the rate before the first entry from what it replaced, even with no starting row', () => {
		const only = [e('2026-10-10', 2_000_000, 'monthly', { rate: 1_000_000, basis: 'monthly' })];
		const t = payTermsFor(only, '2026-10-01', '2026-10-15', fallback);
		expect(t.segments).toEqual([
			{ start: '2026-10-01', end: '2026-10-09', baseRateCentavos: 1_000_000 },
			{ start: '2026-10-10', end: '2026-10-15', baseRateCentavos: 2_000_000 }
		]);
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

describe.skipIf(!live)('adjusting a salary (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { employees, establishments, salaryHistory } = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { eq } = await import('drizzle-orm');
	const S = await import('./salary');

	const tag = `saltest-${Math.random().toString(36).slice(2, 10)}`;
	let org = '';
	let est = '';
	let emp = '';

	beforeAll(async () => {
		org = await testOrgId();
		const [x] = await db
			.insert(establishments)
			.values({ organizationId: org, kind: 'business', slug: tag, name: 'Salary test', orgRef: mintRef('org') })
			.returning({ id: establishments.id });
		est = x!.id;
		emp = await createTestStaff(est, { employeeNo: 'SL1', firstName: 'Sal', hiredOn: '2025-01-01' });
		await db.insert(salaryHistory).values({
			employeeId: emp,
			effectiveFrom: '2025-01-01',
			payBasis: 'monthly',
			baseRateCentavos: 1_000_000,
			remarks: 'Starting salary'
		});
	});
	afterAll(async () => {
		await db.delete(salaryHistory).where(eq(salaryHistory.employeeId, emp));
		await cleanupTestEstablishments([est]);
	});

	const adjust = (over: Partial<Parameters<typeof S.adjustSalary>[1]>) =>
		S.adjustSalary(org, { employeeId: emp, payBasis: 'monthly', rate: 11_000, effectiveFrom: '2025-06-01', remarks: 'Merit increase', ...over }, null);

	it('records the movement with what it replaced, and makes the new rate current once its date has come', async () => {
		const r = await adjust({});
		expect(r.entry).toMatchObject({ baseRateCentavos: 1_100_000, previousRateCentavos: 1_000_000, remarks: 'Merit increase' });
		const [person] = await db.select().from(employees).where(eq(employees.id, emp));
		expect(person!.baseRateCentavos).toBe(1_100_000);

		const history = await S.listHistory(emp);
		expect(history.map((h) => h.remarks)).toEqual(['Merit increase', 'Starting salary']);
		expect(history[0]).toMatchObject({ change: 100_000, isCurrent: true });
		expect(history[0]!.percent).toBeCloseTo(10);
	});

	it('keeps a future-dated raise on file without changing today’s rate', async () => {
		await adjust({ rate: 12_000, effectiveFrom: '2099-01-01', remarks: 'Planned promotion' });
		const [person] = await db.select().from(employees).where(eq(employees.id, emp));
		expect(person!.baseRateCentavos).toBe(1_100_000);
		const history = await S.listHistory(emp);
		expect(history[0]).toMatchObject({ isFuture: true, isCurrent: false });
		expect(history.find((h) => h.isCurrent)!.baseRateCentavos).toBe(1_100_000);
	});

	it('refuses a missing reason, a date before hire, a duplicate date, and a change to the same pay', async () => {
		expect(S.adjustSchema.safeParse({ employeeId: emp, payBasis: 'monthly', rate: 1, effectiveFrom: '2026-01-01', remarks: 'x' }).success).toBe(false);
		await expect(adjust({ effectiveFrom: '2024-01-01', rate: 12_000 })).rejects.toThrow(/before they were hired/);
		await expect(adjust({ effectiveFrom: '2025-06-01', rate: 13_000 })).rejects.toThrow(/already an adjustment on that date/);
		await expect(adjust({ effectiveFrom: '2025-09-01', rate: 11_000 })).rejects.toThrow(/same as the salary in force/);
	});
});
