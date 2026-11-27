import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

/**
 * Live-DB tests for Inventory → Restock: one receipt adds a batch per line and one unpaid expense
 * in the same transaction (nothing at all if either fails); voiding takes the stock back and voids
 * the expense, but not once the delivery is used or Finance has paid it. Own throwaway hotel.
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

describe.skipIf(!hasDb)('stock: restock from a receipt (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { seedFinanceDefaults } = await import('./finance/seed-defaults');
	const stock = await import('./stock');

	const tag = `stockrs-${Math.random().toString(36).slice(2, 8)}`;
	let hotel = '';
	let category = '';
	let rice = '';
	let oil = '';

	beforeAll(async () => {
		const [h] = await db.insert(s.hotels).values({ slug: tag, name: 'Restock', orgRef: mintRef('org') }).returning();
		hotel = h!.id;
		await seedFinanceDefaults(db, hotel);
		category = (await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.hotelId, hotel)))[0]!.id;
		const mk = (name: string, unit: 'g' | 'ml') => stock.createStockItem(hotel, { name, department: 'dining', kind: 'consumable', unit, reorderLevelMilli: null }, null);
		rice = await mk('Rice', 'g');
		oil = await mk('Cooking oil', 'ml');
	});

	afterAll(async () => {
		if (!hotel) return;
		await db.delete(s.auditLog).where(eq(s.auditLog.hotelId, hotel));
		await db.delete(s.stockRestocks).where(eq(s.stockRestocks.hotelId, hotel));
		await db.delete(s.expenses).where(eq(s.expenses.hotelId, hotel));
		await db.delete(s.hotels).where(eq(s.hotels.id, hotel));
	});

	const onHand = async (id: string) => (await stock.listStock(hotel)).find((r) => r.id === id)!.onHandMilli;
	const receipt = (over: Partial<Parameters<typeof stock.createRestock>[0]> = {}) =>
		stock.createRestock({
			hotelId: hotel,
			receiptDate: '2031-03-01',
			vendorId: null,
			vendorName: 'Palengke Supplier',
			receiptNo: 'OR-123',
			totalCentavos: 185_000,
			isVatable: false,
			categoryId: category,
			source: 'dining',
			attachmentUrl: null,
			note: null,
			lines: [
				{ itemId: rice, qtyMilli: 25_000_000, expiresOn: '2031-09-01' },
				{ itemId: oil, qtyMilli: 2_000_000 }
			],
			actor: null,
			...over
		});

	it('adds a batch per line and one unpaid expense carrying the receipt', async () => {
		const id = await receipt();
		expect(await onHand(rice)).toBe(25_000_000);
		expect(await onHand(oil)).toBe(2_000_000);
		const got = await stock.getRestock(hotel, id);
		expect(got!.restock).toMatchObject({ supplier: 'Palengke Supplier', receiptNo: 'OR-123', totalCentavos: 185_000, lines: 2 });
		const [e] = await db.select().from(s.expenses).where(eq(s.expenses.id, got!.restock.expenseId!));
		expect(e).toMatchObject({ grossCentavos: 185_000, vendorName: 'Palengke Supplier', vendorInvoiceNo: 'OR-123', source: 'dining', expenseDate: '2031-03-01' });
		expect(['draft', 'approved']).toContain(e!.status); // Finance pays it later
		expect(e!.notes).toContain('Rice 25 kg');
		expect(await stock.restockForExpense(hotel, e!.id)).toMatchObject({ id });
	});

	it('is all or nothing: a bad category leaves no stock and no receipt', async () => {
		const before = await onHand(rice);
		await expect(receipt({ categoryId: '00000000-0000-0000-0000-000000000000' })).rejects.toThrow(/category/);
		expect(await onHand(rice)).toBe(before);
		await expect(receipt({ lines: [] })).rejects.toThrow(/at least one item/);
		await expect(receipt({ lines: [{ itemId: rice, qtyMilli: 1000 }, { itemId: rice, qtyMilli: 1000 }] })).rejects.toThrow(/listed twice/);
	});

	it('voids an untouched receipt (stock back out, expense void), but not a used or paid one', async () => {
		const id = await receipt({ receiptNo: 'OR-200' });
		const r0 = await onHand(rice);
		await stock.voidRestock(hotel, id, 'Wrong supplier', null);
		expect(await onHand(rice)).toBe(r0 - 25_000_000);
		const got = await stock.getRestock(hotel, id);
		expect(got!.restock.voidedAt).not.toBeNull();
		expect(got!.restock.expenseStatus).toBe('void');
		await expect(stock.voidRestock(hotel, id, 'again', null)).rejects.toThrow(/already voided/);

		// Used: some rice has gone out since this delivery came in.
		const used = await receipt({ receiptNo: 'OR-300', lines: [{ itemId: oil, qtyMilli: 1_000_000 }] });
		const oilNow = await onHand(oil);
		await db.transaction((tx) => stock.drawDown(tx, { hotelId: hotel, itemId: oil, qtyMilli: oilNow, type: 'waste', note: 'spilled', actorId: null }));
		await expect(stock.voidRestock(hotel, used, 'mistake', null)).rejects.toThrow(/already used/);

		// Paid: Finance must undo the payment first.
		const paid = await receipt({ receiptNo: 'OR-400', lines: [{ itemId: rice, qtyMilli: 1_000 }] });
		const p = await stock.getRestock(hotel, paid);
		await db.update(s.expenses).set({ status: 'paid' }).where(eq(s.expenses.id, p!.restock.expenseId!));
		await expect(stock.voidRestock(hotel, paid, 'mistake', null)).rejects.toThrow(/already paid/);
		await expect(stock.voidRestock(hotel, paid, ' ', null)).rejects.toThrow(/why/);
	});
});
