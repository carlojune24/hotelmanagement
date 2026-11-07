import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB test for the Hotel / Dining toggle on Finance → Cash: each movement lands on exactly one
 * side, by where the money came from, even on a shared account. Own throwaway hotel; skipped when
 * no DATABASE_URL.
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

describe.skipIf(!hasDb)('cash movements by side (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { seedFinanceDefaults } = await import('./seed-defaults');
	const { listMovements, movementTotals } = await import('./cash');

	let hotelId = '';
	const acct: Record<string, string> = {};
	const DAY = '2031-09-10';

	async function move(m: { account: string; direction: 'in' | 'out'; category: (typeof s.cashMovements.$inferInsert)['category']; amount: number; sourceType?: string; sourceId?: string; transferGroupId?: string; side?: 'hotel' | 'dining'; memo: string }) {
		await db.insert(s.cashMovements).values({
			hotelId,
			businessDate: DAY,
			direction: m.direction,
			category: m.category,
			cashAccountId: acct[m.account]!,
			amountCentavos: m.amount,
			sourceType: m.sourceType ?? 'payment',
			sourceId: m.sourceId,
			transferGroupId: m.transferGroupId,
			side: m.side,
			memo: m.memo
		});
	}

	beforeAll(async () => {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `cashside-${Math.random().toString(36).slice(2, 10)}`, name: 'Cash side', orgRef: mintRef('org') })
			.returning({ id: s.hotels.id });
		hotelId = h!.id;
		await seedFinanceDefaults(db, hotelId);
		for (const a of await db.select().from(s.cashAccounts).where(eq(s.cashAccounts.hotelId, hotelId))) acct[a.name] = a.id;
		const [cat] = await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.hotelId, hotelId)).limit(1);
		const expense = (source: 'hotel' | 'dining') =>
			db
				.insert(s.expenses)
				.values({ hotelId, expenseDate: DAY, categoryId: cat!.id, description: source, source, grossCentavos: 1, netOfVatCentavos: 1, status: 'paid' })
				.returning({ id: s.expenses.id })
				.then((r) => r[0]!.id);

		const bank = 'Bank — Main';
		await move({ account: 'Front Desk Drawer', direction: 'in', category: 'room_revenue', amount: 100, memo: 'room' });
		await move({ account: bank, direction: 'in', category: 'dining_revenue', amount: 200, sourceType: 'dining_payment', memo: 'dining online' });
		await move({ account: bank, direction: 'out', category: 'refund', amount: 300, sourceType: 'dining_refund', memo: 'dining refund' });
		await move({ account: bank, direction: 'out', category: 'refund', amount: 400, memo: 'room refund' });
		await move({ account: bank, direction: 'out', category: 'expense', amount: 500, sourceType: 'expense', sourceId: await expense('dining'), memo: 'dining expense' });
		await move({ account: bank, direction: 'out', category: 'expense', amount: 600, sourceType: 'expense', sourceId: await expense('hotel'), memo: 'hotel expense' });
		await move({ account: 'Dining Desk Drawer', direction: 'in', category: 'adjustment', amount: 700, sourceType: 'shift_open', memo: 'dining float' });
		const drop = randomUUID();
		await move({ account: 'Dining Desk Drawer', direction: 'out', category: 'transfer_out', amount: 800, sourceType: 'transfer', transferGroupId: drop, memo: 'drop out' });
		await move({ account: bank, direction: 'in', category: 'transfer_in', amount: 800, sourceType: 'transfer', transferGroupId: drop, memo: 'drop in' });
		const shuffle = randomUUID();
		await move({ account: bank, direction: 'out', category: 'transfer_out', amount: 900, sourceType: 'transfer', transferGroupId: shuffle, memo: 'bank to e-wallet' });
		await move({ account: 'E-wallet', direction: 'in', category: 'transfer_in', amount: 900, sourceType: 'transfer', transferGroupId: shuffle, memo: 'e-wallet from bank' });
		await move({ account: bank, direction: 'in', category: 'other_revenue', amount: 1000, sourceType: 'manual', side: 'dining', memo: 'manual dining' });
		await move({ account: 'Dining Desk Drawer', direction: 'out', category: 'adjustment', amount: 1100, sourceType: 'manual', side: 'hotel', memo: 'manual hotel on dining drawer' });
	});

	afterAll(async () => {
		if (hotelId) await db.delete(s.hotels).where(inArray(s.hotels.id, [hotelId]));
	});

	const memos = (rows: { memo: string | null }[]) => rows.map((r) => r.memo).sort();

	it('splits every movement onto one side by its origin, shared accounts included', async () => {
		const [all, hotel, dining] = await Promise.all([
			listMovements(hotelId, {}),
			listMovements(hotelId, { side: 'hotel' }),
			listMovements(hotelId, { side: 'dining' })
		]);
		expect(memos(dining)).toEqual(['dining expense', 'dining float', 'dining online', 'dining refund', 'drop in', 'drop out', 'manual dining']);
		expect(memos(hotel)).toEqual(['hotel expense', 'manual hotel on dining drawer', 'room', 'room refund']);
		// bank → e-wallet is neither side's money: listed only under All.
		expect(memos(all.filter((r) => r.side === 'shared'))).toEqual(['bank to e-wallet', 'e-wallet from bank']);
		expect(all).toHaveLength(hotel.length + dining.length + 2);
	});

	it('totals cover every matching movement, and Hotel + Dining + shared transfers add up to All', async () => {
		const [all, hotel, dining, few] = await Promise.all([
			movementTotals(hotelId, {}),
			movementTotals(hotelId, { side: 'hotel' }),
			movementTotals(hotelId, { side: 'dining' }),
			listMovements(hotelId, { side: 'dining', limit: 2 })
		]);
		expect(few).toHaveLength(2);
		expect(dining).toEqual({ count: 7, inCentavos: 200 + 700 + 800 + 1000, outCentavos: 300 + 500 + 800 });
		expect(hotel).toEqual({ count: 4, inCentavos: 100, outCentavos: 400 + 600 + 1100 });
		expect(all.inCentavos).toBe(hotel.inCentavos + dining.inCentavos + 900);
		expect(all.outCentavos).toBe(hotel.outCentavos + dining.outCentavos + 900);
	});

	it('profit & loss splits Hotel and Dining, and they add up to Overall', async () => {
		const { profitLossReport } = await import('./reports');
		const [all, hotel, dining] = await Promise.all([
			profitLossReport(hotelId, DAY, DAY, 'all'),
			profitLossReport(hotelId, DAY, DAY, 'hotel'),
			profitLossReport(hotelId, DAY, DAY, 'dining')
		]);
		// Dining: dining sale 200 + other revenue tagged Dining by hand 1000, less the dining refund 300, less its expense 1.
		expect(dining.revenue.netCentavos).toBe(200 + 1000 - 300);
		expect(dining.expenses.totalGrossCentavos).toBe(1);
		expect(dining.profitCentavos).toBe(899);
		// Hotel: room 100, less the room refund 400, less its expense 1.
		expect(hotel.profitCentavos).toBe(100 - 400 - 1);
		expect(all.profitCentavos).toBe(hotel.profitCentavos + dining.profitCentavos);
		expect(all.revenue.totalCentavos).toBe(hotel.revenue.totalCentavos + dining.revenue.totalCentavos);
	});

	it('the CSV export and the print sheet follow the Hotel / Dining filter', async () => {
		const [hotel] = await db.select().from(s.hotels).where(eq(s.hotels.id, hotelId));
		const locals = {
			hotel: { ...hotel!, timezone: 'Asia/Manila' },
			user: { id: 'u', isPlatformAdmin: false },
			role: { id: 'r', slug: 'r', name: 'R', isProtected: false, capabilities: ['finance:read'] }
		};
		const url = new URL(`http://x/?src=dining&from=${DAY}&to=${DAY}`);
		const { GET } = await import('../../../routes/[hotel]/management/finance/cash/export/+server');
		const res = await GET({ locals, url } as never);
		const lines = (await res.text()).trim().split(/\r?\n/);
		expect(res.headers.get('content-disposition')).toContain(`cash-dining-${DAY}-${DAY}.csv`);
		expect(lines).toHaveLength(1 + 7);
		expect(lines.slice(1).every((l) => l.includes(',Dining,'))).toBe(true);

		const { load } = await import('../../../routes/[hotel]/print/cash/+page.server');
		const page = (await load({ locals, url } as never)) as { doc: { title: string; sections: { rows: unknown[]; total?: unknown[] }[] } };
		expect(page.doc.title).toBe('Dining cash movements');
		expect(page.doc.sections[0]!.rows).toHaveLength(7);
		expect(page.doc.sections[0]!.total).toEqual(['Total', '', '', '', '', 2700, 1600]);
	});

	it('tags an account Dining when it is chosen as the dining drawer in Finance settings', async () => {
		const { updateFinanceSettings } = await import('./settings');
		const petty = acct['Petty Cash']!;
		await updateFinanceSettings(hotelId, { diningDrawerAccountId: petty }, null);
		const [a] = await db.select({ side: s.cashAccounts.side }).from(s.cashAccounts).where(eq(s.cashAccounts.id, petty));
		expect(a!.side).toBe('dining');
		// …and its old hotel movements now read as dining: nothing else needs re-tagging.
		expect((await listMovements(hotelId, { cashAccountId: petty })).every((m) => m.side === 'dining')).toBe(true);
	});
});
