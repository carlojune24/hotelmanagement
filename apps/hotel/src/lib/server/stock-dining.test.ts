import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for dining's automatic stock deduction, driven through the real order functions:
 * an order reaching the kitchen takes its recipe (dish × quantity, plus add-ons), a QR order only
 * once accepted, a cancel before cooking puts it back, a cancel after cooking does not, and the
 * open batches always equal what is really on hand. Own throwaway hotel; skipped without a DB.
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

describe.skipIf(!hasDb)('stock: dining recipes (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { stationIdFor } = await import('./test-station');
	const o = await import('./dining-orders');
	const stock = await import('./stock');

	const tag = `stockdn-${Math.random().toString(36).slice(2, 8)}`;
	let hotel = '';
	let venue = '';
	let adobo = '';
	let rice = '';
	let pork = '';
	let riceStock = '';

	beforeAll(async () => {
		const [h] = await db.insert(s.hotels).values({ slug: tag, name: 'Stock dining', orgRef: mintRef('org') }).returning();
		hotel = h!.id;
		const [v] = await db.insert(s.diningItems).values({ hotelId: hotel, title: 'Cafe' }).returning();
		venue = v!.id;
		const [dish] = await db
			.insert(s.diningMenuItems)
			.values({ hotelId: hotel, diningItemId: venue, name: 'Adobo', priceCentavos: 25_000, stationId: await stationIdFor(hotel) })
			.returning();
		adobo = dish!.id;
		const [g] = await db.insert(s.diningAddonGroups).values({ hotelId: hotel, diningItemId: venue, name: 'Sides', minChoices: 0, maxChoices: 1 }).returning();
		const [a] = await db.insert(s.diningAddons).values({ hotelId: hotel, groupId: g!.id, name: 'Rice', priceCentavos: 0 }).returning();
		rice = a!.id;
		await db.insert(s.diningMenuItemAddonGroups).values({ menuItemId: adobo, addonGroupId: g!.id });

		pork = await stock.createStockItem(hotel, { name: 'Pork', department: 'dining', kind: 'consumable', unit: 'g', reorderLevelMilli: null }, null);
		riceStock = await stock.createStockItem(hotel, { name: 'Rice', department: 'dining', kind: 'consumable', unit: 'g', reorderLevelMilli: null }, null);
		await stock.setRecipe(hotel, { menuItemId: adobo }, [{ stockItemId: pork, qtyMilli: 150_000 }], null); // 150 g a serving
		await stock.setRecipe(hotel, { addonId: rice }, [{ stockItemId: riceStock, qtyMilli: 200_000 }], null); // 200 g a cup
		await stock.receiveStock({ hotelId: hotel, itemId: pork, qtyMilli: 1_000_000, actor: null }); // 1 kg
		await stock.receiveStock({ hotelId: hotel, itemId: riceStock, qtyMilli: 5_000_000, actor: null });
	});

	afterAll(async () => {
		if (!hotel) return;
		await db.delete(s.auditLog).where(eq(s.auditLog.hotelId, hotel)); // audit_log has no FK, so it would outlive the hotel
		await db.delete(s.hotels).where(eq(s.hotels.id, hotel));
	});

	const onHand = async (itemId: string) => (await stock.listStock(hotel)).find((r) => r.id === itemId)!.onHandMilli;
	/** Open batches must always add up to real on hand (or zero when it is negative). */
	const assertBatchesTrue = async (itemId: string) => {
		const rows = await db.select().from(s.stockMovements).where(eq(s.stockMovements.itemId, itemId));
		const open = rows.reduce((t, r) => t + (r.qtyRemainingMilli ?? 0), 0);
		expect(open).toBe(Math.max(0, await onHand(itemId)));
	};
	const place = (qty: number, extra: Record<string, unknown> = {}) =>
		o.createDiningOrder({ hotelId: hotel, venueId: venue, orderType: 'takeaway', lines: [{ menuItemId: adobo, quantity: qty, addonIds: [rice] }], ...extra });

	it('deducts dish × quantity and add-ons when the order reaches the kitchen', async () => {
		const p0 = await onHand(pork);
		const r0 = await onHand(riceStock);
		await place(2);
		expect(await onHand(pork)).toBe(p0 - 300_000);
		expect(await onHand(riceStock)).toBe(r0 - 400_000);
		await assertBatchesTrue(pork);
	});

	it('a QR order waiting for staff takes nothing until accepted, and only once', async () => {
		const p0 = await onHand(pork);
		const c = await place(1, { initialStatus: 'pending_acceptance' });
		expect(await onHand(pork)).toBe(p0);
		await o.acceptOrder({ hotelId: hotel, orderId: c.id });
		expect(await onHand(pork)).toBe(p0 - 150_000);
		await db.transaction((tx) => stock.syncDiningOrderStock(tx, hotel, c.id)); // a second call changes nothing
		expect(await onHand(pork)).toBe(p0 - 150_000);
	});

	it('a cancel before cooking puts the ingredients back; after cooking it does not', async () => {
		const p0 = await onHand(pork);
		const early = await place(1);
		await o.cancelDiningOrder({ hotelId: hotel, orderId: early.id, reason: 'Guest left' });
		expect(await onHand(pork)).toBe(p0);
		await assertBatchesTrue(pork);

		const cooked = await place(1);
		await o.setDiningOrderStatus({ hotelId: hotel, orderId: cooked.id, to: 'preparing' });
		await o.cancelDiningOrder({ hotelId: hotel, orderId: cooked.id, reason: 'Sent back' });
		expect(await onHand(pork)).toBe(p0 - 150_000); // that pork was cooked
	});

	it('oversells into negative without blocking, and a cancel then keeps batches honest', async () => {
		const left = await onHand(pork);
		const big = await place(Math.ceil(left / 150_000) + 2); // more than is on hand
		expect(await onHand(pork)).toBeLessThan(0);
		await assertBatchesTrue(pork);
		await stock.receiveStock({ hotelId: hotel, itemId: pork, qtyMilli: 2_000_000, actor: null });
		await assertBatchesTrue(pork);
		await o.cancelDiningOrder({ hotelId: hotel, orderId: big.id, reason: 'Wrong table' });
		await assertBatchesTrue(pork);
		const reversed = await db.select().from(s.stockMovements).where(eq(s.stockMovements.diningOrderId, big.id));
		expect(reversed.reduce((t, r) => t + r.qtyMilli, 0)).toBe(0);
	});

	it('a dish with no recipe moves no stock, and a recipe cannot use another hotel’s item', async () => {
		const [plain] = await db
			.insert(s.diningMenuItems)
			.values({ hotelId: hotel, diningItemId: venue, name: 'Water', priceCentavos: 1_000, stationId: await stationIdFor(hotel) })
			.returning();
		const c = await o.createDiningOrder({ hotelId: hotel, venueId: venue, orderType: 'takeaway', lines: [{ menuItemId: plain!.id, quantity: 1 }] });
		expect(await db.select().from(s.stockMovements).where(eq(s.stockMovements.diningOrderId, c.id))).toEqual([]);

		const [other] = await db.insert(s.hotels).values({ slug: `${tag}-x`, name: 'Other', orgRef: mintRef('org') }).returning();
		try {
			const foreign = await stock.createStockItem(other!.id, { name: 'Salt', department: 'dining', kind: 'consumable', unit: 'g', reorderLevelMilli: null }, null);
			await expect(stock.setRecipe(hotel, { menuItemId: plain!.id }, [{ stockItemId: foreign, qtyMilli: 1_000 }], null)).rejects.toThrow(/not found/);
		} finally {
			await db.delete(s.auditLog).where(inArray(s.auditLog.hotelId, [other!.id]));
			await db.delete(s.hotels).where(inArray(s.hotels.id, [other!.id]));
		}
	});
});
