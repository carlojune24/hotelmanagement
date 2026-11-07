import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * The Hotel / Dining split end to end through the real page loaders and form actions (no browser):
 * tagging an expense, a recurring template, a manual cash entry and an owner draw; a payout from the
 * dining drawer; the Cash page under the toggle; re-tagging an account; and the Profit & loss report.
 * Own throwaway hotel and user; skipped when no DATABASE_URL.
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

describe.skipIf(!hasDb)('hotel / dining split through the finance pages (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { seedFinanceDefaults } = await import('$lib/server/finance/seed-defaults');
	const { businessDateFor } = await import('$lib/server/finance/shared');
	const { openShift, addShiftEvent } = await import('$lib/server/finance/shifts');
	const { generateDueRecurringExpenses } = await import('$lib/server/finance/expenses');
	const { runReport } = await import('$lib/server/finance/report-runner');
	const expensesPage = await import('./expenses/+page.server');
	const recurringPage = await import('./expenses/recurring/+page.server');
	const cashPage = await import('./cash/+page.server');
	const settingsPage = await import('./settings/+page.server');

	const tag = `hdflow-${Math.random().toString(36).slice(2, 10)}`;
	let hotel: typeof s.hotels.$inferSelect;
	let userId = '';
	let today = '';
	let categoryId = '';
	const acct: Record<string, string> = {};

	const locals = () =>
		({
			hotel,
			user: { id: userId, email: `${tag}@example.test`, name: 'Flow tester', isPlatformAdmin: false },
			role: {
				id: 'r',
				slug: 'r',
				name: 'Role',
				isProtected: false,
				capabilities: ['hotel:admin', 'finance:read', 'finance:write', 'expense:create', 'expense:approve', 'expense:pay']
			}
		}) as never;
	const post = (fields: Record<string, string>) => {
		const fd = new FormData();
		for (const [k, v] of Object.entries(fields)) fd.set(k, v);
		return new Request('http://localhost/x', { method: 'POST', body: fd });
	};
	const act = (action: unknown, fields: Record<string, string>) =>
		(action as (e: unknown) => Promise<unknown>)({ locals: locals(), request: post(fields), url: new URL('http://localhost/x') });
	const status = (r: unknown) => (r as { status?: number } | undefined)?.status;

	beforeAll(async () => {
		const [u] = await db
			.insert(s.users)
			.values({ email: `${tag}@example.test`, name: 'Flow tester', passwordHash: null })
			.returning({ id: s.users.id });
		userId = u!.id;
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: tag, name: 'Flow hotel', orgRef: mintRef('org'), timezone: 'Asia/Manila' })
			.returning();
		hotel = h!;
		await seedFinanceDefaults(db, hotel.id);
		today = businessDateFor(hotel.timezone);
		for (const a of await db.select().from(s.cashAccounts).where(eq(s.cashAccounts.hotelId, hotel.id))) acct[a.name] = a.id;
		const [c] = await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.hotelId, hotel.id)).limit(1);
		categoryId = c!.id;
	});

	afterAll(async () => {
		if (hotel) await db.delete(s.hotels).where(eq(s.hotels.id, hotel.id));
		if (userId) await db.delete(s.users).where(inArray(s.users.id, [userId]));
	});

	it('seeds the drawers with their side', async () => {
		const sides = Object.fromEntries(
			(await db.select().from(s.cashAccounts).where(eq(s.cashAccounts.hotelId, hotel.id))).map((a) => [a.name, a.side])
		);
		expect(sides).toMatchObject({ 'Front Desk Drawer': 'hotel', 'Dining Desk Drawer': 'dining', 'Petty Cash': 'hotel', 'Bank — Main': 'shared' });
	});

	it('New expense: must be tagged, and keeps its tag', async () => {
		const base = { expenseDate: today, categoryId, description: `${tag} gas`, gross: '500' };
		expect(status(await act(expensesPage.actions.create, base))).toBe(400);
		await act(expensesPage.actions.create, { ...base, source: 'dining' });
		const [e] = await db.select().from(s.expenses).where(and(eq(s.expenses.hotelId, hotel.id), eq(s.expenses.description, `${tag} gas`)));
		expect(e!.source).toBe('dining');

		const page = (await expensesPage.load({ locals: locals(), url: new URL('http://localhost/x?src=hotel') } as never)) as { rows: unknown[] };
		expect(page.rows).toHaveLength(0);
	});

	it('Recurring template: tag required, and generated expenses inherit it', async () => {
		const base = { categoryId, description: `${tag} rent`, amount: '1000', cadence: 'monthly', anchorDay: '1', nextDueOn: today };
		expect(status(await act(recurringPage.actions.create, base))).toBe(400);
		await act(recurringPage.actions.create, { ...base, source: 'dining' });
		await generateDueRecurringExpenses(hotel.id, today, null);
		const [e] = await db.select().from(s.expenses).where(and(eq(s.expenses.hotelId, hotel.id), eq(s.expenses.description, `${tag} rent`)));
		expect(e!.source).toBe('dining');
	});

	it('A payout from the dining drawer is a Dining expense; from the front desk, Hotel', async () => {
		for (const [drawer, reason] of [['Dining Desk Drawer', `${tag} ice`], ['Front Desk Drawer', `${tag} soap`]] as const) {
			const { shiftId } = await openShift({ hotelId: hotel.id, cashAccountId: acct[drawer]!, businessDate: today, openingFloatCentavos: 100_000, actor: null });
			await addShiftEvent({ hotelId: hotel.id, shiftId, kind: 'payout', amountCentavos: 2_000, reason, expenseCategoryId: categoryId, actor: null });
		}
		const rows = await db.select().from(s.expenses).where(eq(s.expenses.hotelId, hotel.id));
		expect(rows.find((r) => r.description === `${tag} ice`)!.source).toBe('dining');
		expect(rows.find((r) => r.description === `${tag} soap`)!.source).toBe('hotel');
	});

	it('Manual entry and owner draw: Hotel or Dining is required and decides the side', async () => {
		const bank = acct['Bank — Main']!;
		const manual = { direction: 'in', category: 'other_revenue', cashAccountId: bank, amount: '75', memo: `${tag} catering`, businessDate: today };
		expect(status(await act(cashPage.actions.manualMovement, manual))).toBe(400);
		await act(cashPage.actions.manualMovement, { ...manual, side: 'dining' });
		const draw = { cashAccountId: bank, amount: '10', memo: `${tag} draw`, businessDate: today };
		expect(status(await act(cashPage.actions.ownerDraw, draw))).toBe(400);
		await act(cashPage.actions.ownerDraw, { ...draw, side: 'hotel' });

		const load = (q: string) =>
			cashPage.load({ locals: locals(), url: new URL(`http://localhost/x${q}`) } as never) as Promise<{
				accounts: { name: string }[];
				movements: { memo: string | null; side: string; direction: string; amountCentavos: number }[];
				totals: { count: number; in: number; out: number };
			}>;
		const [all, dining] = await Promise.all([load(''), load(`?src=dining&from=${today}&to=${today}`)]);
		// Under Dining only the dining drawer's balance shows; its movements still include the bank entry.
		expect(dining.accounts.map((a) => a.name)).toEqual(['Dining Desk Drawer']);
		expect(dining.movements.find((m) => m.memo === `${tag} catering`)?.side).toBe('dining');
		expect(dining.movements.some((m) => m.memo === `${tag} draw`)).toBe(false);
		expect(all.movements.find((m) => m.memo === `${tag} draw`)?.side).toBe('hotel');
		// Fewer than 400 rows, so the server totals must equal the listed rows.
		const sum = (d: string) => dining.movements.filter((m) => m.direction === d).reduce((t, m) => t + m.amountCentavos, 0);
		expect(dining.totals).toMatchObject({ in: sum('in'), out: sum('out') });
	});

	it('Finance settings: an account can be re-tagged', async () => {
		await act(settingsPage.actions.updateAccount, { id: acct['Petty Cash']!, side: 'dining' });
		const [a] = await db.select().from(s.cashAccounts).where(eq(s.cashAccounts.id, acct['Petty Cash']!));
		expect(a!.side).toBe('dining');
		expect(status(await act(settingsPage.actions.updateAccount, { id: acct['Petty Cash']!, side: 'everything' }))).toBe(400);
	});

	it('Profit & loss report: Hotel + Dining = Overall, and Overall shows both profits', async () => {
		const opts = { timezone: hotel.timezone, from: today, to: today };
		const [all, hotelR, diningR] = await Promise.all([
			runReport(hotel.id, 'profit-loss', opts),
			runReport(hotel.id, 'profit-loss', { ...opts, scope: 'hotel' }),
			runReport(hotel.id, 'profit-loss', { ...opts, scope: 'dining' })
		]);
		const val = (r: typeof all, k: RegExp) => Number(r!.summary.find(([key]) => k.test(key))![1]);
		expect(diningR!.name).toBe('Profit & loss — Dining');
		expect(val(diningR, /^(Profit|Loss)$/)).toBe(75 - 500 - 1000 - 20); // catering in; gas, rent and the ice payout out
		expect(val(hotelR, /^(Profit|Loss)$/)).toBe(-20); // the soap payout
		expect(val(all, /^(Profit|Loss)$/)).toBe(val(hotelR, /^(Profit|Loss)$/) + val(diningR, /^(Profit|Loss)$/));
		expect(val(all, /^Dining profit$/)).toBe(val(diningR, /^(Profit|Loss)$/));
		expect(val(all, /^Hotel profit$/)).toBe(val(hotelR, /^(Profit|Loss)$/));
	});
});
