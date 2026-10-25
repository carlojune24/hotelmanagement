import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { stationIdFor } from '$lib/server/test-station';

/**
 * Live-DB tests for a table reservation that carries an order: the kitchen does not see it until
 * the guests are due, it joins the table's bill when they sit down, and it is released when the
 * booking is cancelled or the guests never come. Own throwaway hotel, removed afterwards; skipped
 * when no DATABASE_URL is configured.
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

describe.skipIf(!hasDb)('reserve a table with an order (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const { seedFinanceDefaults } = await import('./finance/seed-defaults');
	const { openShift } = await import('./finance/shifts');
	const { businessDateFor } = await import('./finance/shared');
	const o = await import('./dining-orders');
	const r = await import('./dining-reservations');
	const c = await import('./dining-checks');
	const b = await import('./dining-badges');

	const tag = `preorder-${Math.random().toString(36).slice(2, 8)}`;
	const hotelIds: string[] = [];
	let hotelId = '';
	let venueId = '';
	let dish = '';
	let tableSeq = 0;
	const MIN = 60_000;

	beforeAll(async () => {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: tag, name: 'Preorder test', orgRef: mintRef('org') })
			.returning({ id: s.hotels.id });
		hotelId = h!.id;
		hotelIds.push(hotelId);
		await seedFinanceDefaults(db, hotelId);
		const [v] = await db.insert(s.diningItems).values({ hotelId, title: 'Cafe' }).returning();
		venueId = v!.id;
		const [item] = await db
			.insert(s.diningMenuItems)
			.values({ hotelId, stationId: await stationIdFor(hotelId), diningItemId: venueId, name: 'Adobo', priceCentavos: 25_000 })
			.returning();
		dish = item!.id;
		const settings = await db.select().from(s.financeSettings).where(eq(s.financeSettings.hotelId, hotelId));
		await openShift({
			hotelId,
			// Dining money goes into dining's own till, so that is the shift to open.
			cashAccountId: settings[0]!.diningDrawerAccountId ?? settings[0]!.defaultDrawerAccountId!,
			businessDate: businessDateFor('Asia/Manila'),
			openingFloatCentavos: 100_000,
			actor: null
		});
	});

	afterAll(async () => {
		if (hotelIds.length) await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	async function mkReservation(startsInMin: number, status: 'confirmed' | 'seated' = 'confirmed') {
		const [t] = await db
			.insert(s.diningTables)
			.values({ hotelId, diningItemId: venueId, name: `P${++tableSeq}`, seats: 4 })
			.returning();
		const [res] = await db
			.insert(s.diningReservations)
			.values({
				hotelId,
				diningItemId: venueId,
				code: `PO-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
				status,
				guestName: 'Pre Guest',
				partySize: 2,
				startsAt: new Date(Date.now() + startsInMin * MIN),
				endsAt: new Date(Date.now() + (startsInMin + 90) * MIN),
				source: 'online'
			})
			.returning();
		await db.insert(s.diningReservationTables).values({ reservationId: res!.id, tableId: t!.id });
		return { id: res!.id, tableId: t!.id, tableName: t!.name, startsInMin };
	}

	const preOrder = (reservationId: string, startsInMin: number, extra: Record<string, unknown> = {}) =>
		o.createDiningOrder({
			hotelId,
			venueId,
			orderType: 'pre_order',
			tableId: null,
			reservationId,
			source: 'online',
			pickupAt: new Date(Date.now() + startsInMin * MIN),
			payMode: 'venue',
			initialStatus: 'new',
			guestName: 'Pre Guest',
			guestPhone: '09170000000',
			lines: [{ menuItemId: dish, quantity: 1 }],
			...extra
		} as never);

	const kitchenIds = async () =>
		(await o.listBoardOrders(hotelId, { servedSince: new Date(Date.now() + 86_400_000), releasedOnly: true })).map((x) => x.id);
	const boardIds = async () =>
		(await o.listBoardOrders(hotelId, { servedSince: new Date(Date.now() + 86_400_000), includeAwaitingAcceptance: true })).map((x) => x.id);
	const row = async (id: string) => (await db.select().from(s.diningOrders).where(eq(s.diningOrders.id, id)))[0]!;

	it('holds a pre-order for a far-off table off the kitchen board, but not off the Orders board', async () => {
		const res = await mkReservation(3 * 24 * 60);
		const kitchenBefore = (await b.listDiningBadges(hotelId, { dining: true, kitchen: true })).kitchen;
		const placed = await preOrder(res.id, res.startsInMin);

		expect(await boardIds()).toContain(placed.id);
		expect(await kitchenIds()).not.toContain(placed.id);
		expect((await b.listDiningBadges(hotelId, { dining: true, kitchen: true })).kitchen).toBe(kitchenBefore);
	});

	it('releases it once the table is within the venue prep time, or the party is seated', async () => {
		const soon = await mkReservation(10); // default prep is 20 minutes
		const near = await preOrder(soon.id, 10);
		expect(await kitchenIds()).toContain(near.id);

		const later = await mkReservation(5 * 60);
		const held = await preOrder(later.id, 5 * 60);
		expect(await kitchenIds()).not.toContain(held.id);
		await r.setReservationStatus({ hotelId, reservationId: later.id, to: 'seated' });
		expect(await kitchenIds()).toContain(held.id);
	});

	it('never holds anything that is not a pre-order for a reservation', async () => {
		const takeaway = await o.createDiningOrder({
			hotelId,
			venueId,
			orderType: 'takeaway',
			tableId: null,
			source: 'online',
			pickupAt: new Date(Date.now() + 3 * 24 * 60 * MIN),
			payMode: 'venue',
			initialStatus: 'new',
			guestName: 'Pickup Guest',
			guestPhone: '09170000001',
			lines: [{ menuItemId: dish, quantity: 1 }]
		} as never);
		expect(await kitchenIds()).toContain(takeaway.id);
	});

	it('puts the pre-order on the table bill when the party is seated, and the bill settles and closes', async () => {
		const res = await mkReservation(2 * 60);
		const placed = await preOrder(res.id, res.startsInMin);
		await db.update(s.diningOrders).set({ paymentStatus: 'paid', paymentMethod: 'gcash' }).where(eq(s.diningOrders.id, placed.id));
		expect((await row(placed.id)).checkId).toBeNull();
		expect(await c.getOpenCheckForTable(hotelId, res.tableId)).toBeNull();

		await r.setReservationStatus({ hotelId, reservationId: res.id, to: 'seated' });

		const check = (await c.getOpenCheckForTable(hotelId, res.tableId))!;
		expect(check.reservationId).toBe(res.id);
		const after = await row(placed.id);
		expect(after).toMatchObject({ checkId: check.id, tableId: res.tableId, tableLabel: res.tableName });

		const open = (await c.listOpenChecks(hotelId)).find((x) => x.id === check.id)!;
		expect(open.orders.map((x) => x.id)).toContain(placed.id);

		// served + already paid: the table closes and the reservation completes
		await o.setDiningOrderStatus({ hotelId, orderId: placed.id, to: 'preparing' });
		await o.setDiningOrderStatus({ hotelId, orderId: placed.id, to: 'ready' });
		await o.setDiningOrderStatus({ hotelId, orderId: placed.id, to: 'served' });
		await c.closeCheck({ hotelId, checkId: check.id });
		expect(await c.getOpenCheckForTable(hotelId, res.tableId)).toBeNull();
		const [done] = await db.select().from(s.diningReservations).where(eq(s.diningReservations.id, res.id));
		expect(done!.status).toBe('completed');
	});

	it('seats a reservation with no pre-order exactly as before: no check is opened', async () => {
		const res = await mkReservation(60);
		await r.setReservationStatus({ hotelId, reservationId: res.id, to: 'seated' });
		expect(await c.getOpenCheckForTable(hotelId, res.tableId)).toBeNull();
	});

	it('cancelling the booking cancels an unpaid pre-order and leaves a paid one as a refund due', async () => {
		const res = await mkReservation(2 * 24 * 60);
		const unpaid = await preOrder(res.id, res.startsInMin);
		const paid = await preOrder(res.id, res.startsInMin);
		await db.update(s.diningOrders).set({ paymentStatus: 'paid', paymentMethod: 'paymongo' }).where(eq(s.diningOrders.id, paid.id));

		await r.setReservationStatus({ hotelId, reservationId: res.id, to: 'cancelled' });

		const u = await row(unpaid.id);
		expect(u).toMatchObject({ status: 'cancelled', paymentStatus: 'unpaid', cancelReason: 'The table reservation was cancelled.' });
		const p = await row(paid.id);
		expect(p).toMatchObject({ status: 'cancelled', paymentStatus: 'paid' });
		const due = (await o.listRefundDueOrders(hotelId)).map((x) => x.id);
		expect(due).toContain(paid.id);
		expect(due).not.toContain(unpaid.id);
	});

	it('a no-show releases it too, but leaves an order the kitchen already started', async () => {
		const res = await mkReservation(60);
		const idle = await preOrder(res.id, res.startsInMin);
		const cooking = await preOrder(res.id, res.startsInMin);
		await o.setDiningOrderStatus({ hotelId, orderId: cooking.id, to: 'preparing' });

		await r.setReservationStatus({ hotelId, reservationId: res.id, to: 'no_show' });

		expect(await row(idle.id)).toMatchObject({ status: 'cancelled', cancelReason: 'The guests did not arrive.' });
		expect((await row(cooking.id)).status).toBe('preparing');
	});

	it("only touches this reservation's pre-orders", async () => {
		const mine = await mkReservation(2 * 24 * 60);
		const other = await mkReservation(2 * 24 * 60);
		const a = await preOrder(mine.id, mine.startsInMin);
		const bOrder = await preOrder(other.id, other.startsInMin);
		await r.setReservationStatus({ hotelId, reservationId: mine.id, to: 'cancelled' });
		expect((await row(a.id)).status).toBe('cancelled');
		expect((await row(bOrder.id)).status).toBe('new');
		const [stillOpen] = await db
			.select()
			.from(s.diningReservations)
			.where(and(eq(s.diningReservations.id, other.id), eq(s.diningReservations.status, 'confirmed')));
		expect(stillOpen).toBeTruthy();
	});
});
