import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for the stock ledger's FIFO: oldest batch first, a shortfall still recorded so
 * stock goes negative, a restock covering the deficit first, concurrent draw-downs never taking
 * the same batch twice, and hotel scoping. Own throwaway hotels, removed afterwards; skipped when
 * no DATABASE_URL is configured.
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

describe.skipIf(!hasDb)('stock ledger (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const stock = await import('./stock');

	const tag = `stocktest-${Math.random().toString(36).slice(2, 8)}`;
	const hotelIds: string[] = [];
	let hotelA = '';
	let hotelB = '';
	let seq = 0;

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `Stock ${suffix}`, orgRef: mintRef('org') })
			.returning({ id: s.hotels.id });
		hotelIds.push(h!.id);
		return h!.id;
	}
	const mkItem = (hotelId = hotelA) =>
		stock.createStockItem(hotelId, { name: `Rice ${seq++}`, department: 'dining', kind: 'consumable', unit: 'g', reorderLevelMilli: null }, null);
	const take = (itemId: string, qtyMilli: number, hotelId = hotelA) =>
		db.transaction((tx) => stock.drawDown(tx, { hotelId, itemId, qtyMilli, type: 'waste', note: 'test', actorId: null }));
	const rows = (itemId: string) =>
		db.select().from(s.stockMovements).where(eq(s.stockMovements.itemId, itemId)).orderBy(asc(s.stockMovements.createdAt));
	const onHand = async (itemId: string, hotelId = hotelA) => (await stock.listStock(hotelId)).find((r) => r.id === itemId)!.onHandMilli;

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
	});

	afterAll(async () => {
		if (!hotelIds.length) return;
		await db.delete(s.stockMovements).where(inArray(s.stockMovements.hotelId, hotelIds));
		await db.delete(s.stockItems).where(inArray(s.stockItems.hotelId, hotelIds));
		await db.delete(s.auditLog).where(inArray(s.auditLog.hotelId, hotelIds));
		await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	it('draws from the oldest batch first, splitting across batches', async () => {
		const id = await mkItem();
		await stock.receiveStock({ hotelId: hotelA, itemId: id, qtyMilli: 3000, actor: null });
		await stock.receiveStock({ hotelId: hotelA, itemId: id, qtyMilli: 5000, actor: null });
		await take(id, 4000);

		const all = await rows(id);
		const [b1, b2] = all.filter((r) => r.type === 'restock');
		expect(b1!.qtyRemainingMilli).toBe(0);
		expect(b2!.qtyRemainingMilli).toBe(4000);
		const out = all.filter((r) => r.type === 'waste');
		expect(out.map((r) => [r.consumedFromId, r.qtyMilli])).toEqual(
			expect.arrayContaining([
				[b1!.id, -3000],
				[b2!.id, -1000]
			])
		);
		expect(await onHand(id)).toBe(4000);
	});

	it('records a shortfall unbatched (stock goes negative) and a restock covers the deficit first', async () => {
		const id = await mkItem();
		await stock.receiveStock({ hotelId: hotelA, itemId: id, qtyMilli: 1000, actor: null });
		await take(id, 2500);
		expect(await onHand(id)).toBe(-1500);
		expect((await rows(id)).filter((r) => r.type === 'waste' && r.consumedFromId === null).map((r) => r.qtyMilli)).toEqual([-1500]);

		await stock.receiveStock({ hotelId: hotelA, itemId: id, qtyMilli: 4000, actor: null });
		const batches = (await rows(id)).filter((r) => r.type === 'restock');
		expect(batches.at(-1)!.qtyRemainingMilli).toBe(2500); // open batches == real on hand
		expect(await onHand(id)).toBe(2500);
	});

	it('two concurrent draw-downs never take the same batch twice', async () => {
		const id = await mkItem();
		await stock.receiveStock({ hotelId: hotelA, itemId: id, qtyMilli: 1000, actor: null });
		await Promise.all([take(id, 700), take(id, 700)]);
		const [batch] = (await rows(id)).filter((r) => r.type === 'restock');
		expect(batch!.qtyRemainingMilli).toBe(0);
		expect(await onHand(id)).toBe(-400);
	});

	it('stays inside its hotel', async () => {
		const id = await mkItem();
		await expect(take(id, 1000, hotelB)).rejects.toThrow(stock.StockError);
		await expect(stock.receiveStock({ hotelId: hotelB, itemId: id, qtyMilli: 1000, actor: null })).rejects.toThrow(stock.StockError);
	});

	it('refuses a unit change once stock has moved, a zero quantity, and a correction without a reason', async () => {
		const id = await mkItem();
		await stock.receiveStock({ hotelId: hotelA, itemId: id, qtyMilli: 1000, actor: null });
		const [item] = await db.select().from(s.stockItems).where(eq(s.stockItems.id, id));
		await expect(
			stock.updateStockItem(hotelA, id, { name: item!.name, department: 'dining', kind: 'consumable', unit: 'ml', reorderLevelMilli: null }, null)
		).rejects.toThrow(/unit can’t change/);
		await expect(stock.receiveStock({ hotelId: hotelA, itemId: id, qtyMilli: 0, actor: null })).rejects.toThrow(stock.StockError);
		await expect(stock.removeStock({ hotelId: hotelA, itemId: id, qtyMilli: 10, type: 'adjust_out', note: ' ', actor: null })).rejects.toThrow(
			stock.StockError
		);
	});

	it('a count correction posts only the difference, both ways, and keeps batches honest', async () => {
		const id = await mkItem();
		await stock.receiveStock({ hotelId: hotelA, itemId: id, qtyMilli: 5000, actor: null });
		expect(await stock.correctCount({ hotelId: hotelA, itemId: id, countedMilli: 3000, note: 'shelf count', actor: null })).toBe(-2000);
		expect(await onHand(id)).toBe(3000);
		await take(id, 4000); // oversold to -1000
		expect(await stock.correctCount({ hotelId: hotelA, itemId: id, countedMilli: 500, note: 'found more', actor: null })).toBe(1500);
		expect(await onHand(id)).toBe(500);
		const open = (await rows(id)).reduce((t, r) => t + (r.qtyRemainingMilli ?? 0), 0);
		expect(open).toBe(500);
		await expect(stock.correctCount({ hotelId: hotelA, itemId: id, countedMilli: 500, note: 'again', actor: null })).rejects.toThrow(/Nothing to correct/);
		await expect(stock.correctCount({ hotelId: hotelA, itemId: id, countedMilli: 100, note: '', actor: null })).rejects.toThrow(/why/);
	});

	it('a stock count posts differences against on hand at finish, needs reasons, and allows one open count', async () => {
		const linens = await mkHotel('count');
		const mk = (name: string) =>
			stock.createStockItem(linens, { name, department: 'hotel', kind: 'reusable', unit: 'pcs', reorderLevelMilli: null }, null);
		const towel = await mk('Towel');
		const sheet = await mk('Bed sheet');
		const curtain = await mk('Curtain');
		for (const id of [towel, sheet, curtain]) await stock.receiveStock({ hotelId: linens, itemId: id, qtyMilli: 50_000, actor: null });
		await stock.createStockItem(linens, { name: 'Rice', department: 'dining', kind: 'consumable', unit: 'g', reorderLevelMilli: null }, null);

		const id = await stock.startCount(linens, 'hotel', 'Monthly linen audit', null);
		await expect(stock.startCount(linens, null, null, null)).rejects.toThrow(/already open/);
		const c = await stock.getCount(linens, id);
		expect(c!.lines.map((l) => l.name).sort()).toEqual(['Bed sheet', 'Curtain', 'Towel']); // Hotel only
		// The summary and each line's live on hand come from subqueries; they must see this count's rows.
		expect([c!.count.lines, c!.count.adjusted]).toEqual([3, 0]);
		expect(c!.lines.every((l) => l.onHandMilli === 50_000)).toBe(true);

		await stock.saveCount(linens, id, [
			{ itemId: towel, countedMilli: 47_000, reason: null },
			{ itemId: sheet, countedMilli: 50_000, reason: null }
		]);
		// Towel differs with no reason → nothing posted.
		await expect(stock.finishCount(linens, id, null)).rejects.toThrow(/remark.*Towel/);
		expect((await stock.listStock(linens)).find((r) => r.id === towel)!.onHandMilli).toBe(50_000);

		// A towel is written off between saving and finishing: the count must not take it twice.
		await stock.removeStock({ hotelId: linens, itemId: towel, qtyMilli: 1_000, type: 'waste', note: 'torn', actor: null });
		await stock.saveCount(linens, id, [{ itemId: towel, countedMilli: 47_000, reason: '2 taken by guests' }]);
		expect(await stock.finishCount(linens, id, null)).toEqual({ adjusted: 1, skipped: 1 });

		const after = await stock.listStock(linens);
		expect(after.find((r) => r.id === towel)!.onHandMilli).toBe(47_000);
		expect(after.find((r) => r.id === curtain)!.onHandMilli).toBe(50_000); // not counted, left alone
		const done = await stock.getCount(linens, id);
		const t = done!.lines.find((l) => l.itemId === towel)!;
		expect([t.expectedMilli, t.varianceMilli]).toEqual([49_000, -2_000]);
		expect([done!.count.lines, done!.count.adjusted, done!.count.status]).toEqual([3, 1, 'finished']);
		await expect(stock.saveCount(linens, id, [])).rejects.toThrow(/already finished/);
		expect(await stock.countLowStock(linens)).toBe(0);
	});

	it('refuses a duplicate item name in the same hotel (any case)', async () => {
		await stock.createStockItem(hotelA, { name: 'Bath Soap', department: 'hotel', kind: 'consumable', unit: 'pcs', reorderLevelMilli: null }, null);
		await expect(
			stock.createStockItem(hotelA, { name: 'bath soap', department: 'hotel', kind: 'consumable', unit: 'pcs', reorderLevelMilli: null }, null)
		).rejects.toThrow(/already an item/);
	});
});
