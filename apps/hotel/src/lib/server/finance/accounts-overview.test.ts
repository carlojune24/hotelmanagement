import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB test for the read-only chart-of-accounts view: every account listed with the cash
 * categories that feed it, and postings summed in the account's own direction. Own throwaway
 * hotels, removed afterwards; skipped when no DATABASE_URL.
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

describe.skipIf(!hasDb)('accounts overview (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { seedFinanceDefaults } = await import('./seed-defaults');
	const { openShift } = await import('./shifts');
	const { recordCashMovement } = await import('./cash');
	const { businessDateFor } = await import('./shared');
	const { listAccountsOverview } = await import('./accounts-overview');

	const tag = `acct-${Math.random().toString(36).slice(2, 10)}`;
	const hotelIds: string[] = [];
	let hotelId = '';
	let otherId = '';
	let drawerId = '';
	let shiftId = '';

	beforeAll(async () => {
		const mk = async (suffix: string) => {
			const [h] = await db.insert(s.hotels).values({ slug: `${tag}-${suffix}`, name: `Accounts ${suffix}`, orgRef: mintRef('org') }).returning({ id: s.hotels.id });
			hotelIds.push(h!.id);
			await seedFinanceDefaults(db, h!.id);
			return h!.id;
		};
		hotelId = await mk('a');
		otherId = await mk('b');
		const [st] = await db.select().from(s.financeSettings).where(eq(s.financeSettings.hotelId, hotelId));
		drawerId = st!.defaultDrawerAccountId!;
		const opened = await openShift({ hotelId, cashAccountId: drawerId, businessDate: businessDateFor('Asia/Manila'), openingFloatCentavos: 0, actor: null });
		shiftId = opened.shiftId;
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	it('lists the whole chart, with Food & Beverage Revenue fed by dining', async () => {
		const list = await listAccountsOverview(hotelId);
		expect(list.length).toBeGreaterThan(15);
		expect(list.map((a) => a.code)).toEqual([...list.map((a) => a.code)].sort());
		const fnb = list.find((a) => a.code === '4040')!;
		expect(fnb).toMatchObject({ name: 'Food & Beverage Revenue', type: 'income', normalBalance: 'credit' });
		expect(fnb.postsFrom).toContain('dining_revenue');
		expect(fnb).toMatchObject({ lines: 0, balanceCentavos: 0 });
	});

	it('sums postings in the account\'s own direction and keeps hotels apart', async () => {
		await recordCashMovement({
			hotelId,
			businessDate: businessDateFor('Asia/Manila'),
			direction: 'in',
			category: 'dining_revenue',
			cashAccountId: drawerId,
			amountCentavos: 33_000,
			shiftId,
			memo: 'Dining test',
			actor: null
		});
		const fnb = (await listAccountsOverview(hotelId)).find((a) => a.code === '4040')!;
		expect(fnb.lines).toBe(1);
		expect(fnb.creditCentavos).toBe(33_000);
		expect(fnb.debitCentavos).toBe(0);
		expect(fnb.balanceCentavos).toBe(33_000);

		// the drawer (a debit-normal asset) went up by the same amount
		const cash = (await listAccountsOverview(hotelId)).filter((a) => a.type === 'asset' && a.lines > 0);
		expect(cash.reduce((n, a) => n + a.balanceCentavos, 0)).toBe(33_000);

		expect((await listAccountsOverview(otherId)).find((a) => a.code === '4040')!.lines).toBe(0);
	});
});
