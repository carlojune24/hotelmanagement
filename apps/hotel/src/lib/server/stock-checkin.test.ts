import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for check-in amenity kits, driven through the real `checkInBooking`: the kit is
 * scaled per room / per guest, what staff confirm is what leaves stock (tagged with the booking
 * code + guest name), a room type with no kit moves nothing, linens can't be put in a kit, and a
 * failed check-in takes nothing. Own throwaway hotels; skipped without a DB.
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

describe.skipIf(!hasDb)('stock: check-in amenity kits (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const stock = await import('./stock');
	const fd = await import('./front-desk');

	const tag = `stockci-${Math.random().toString(36).slice(2, 8)}`;
	const hotelIds: string[] = [];
	let hotel = '';
	let deluxe = '';
	let plain = '';
	let guest = '';
	let plan = '';
	let soap = '';
	let brush = '';
	let roomSeq = 100;

	async function mkHotel(suffix: string) {
		const [h] = await db.insert(s.hotels).values({ slug: `${tag}-${suffix}`, name: `Kit ${suffix}`, orgRef: mintRef('org') }).returning();
		hotelIds.push(h!.id);
		return h!.id;
	}

	/** A confirmed, paid booking of `rooms` rooms of `roomTypeId` for `guests` guests, with free rooms to pick. */
	async function mkBooking(roomTypeId: string, rooms: number, guests: number) {
		const roomIds: string[] = [];
		for (let i = 0; i < rooms; i++) {
			const [r] = await db.insert(s.rooms).values({ hotelId: hotel, roomTypeId, roomNumber: String(roomSeq++) }).returning();
			roomIds.push(r!.id);
		}
		const money = { subtotalCentavos: 100_000, feesCentavos: 0, vatCentavos: 12_000, totalCentavos: 112_000 };
		const [o] = await db.insert(s.orders).values({ hotelId: hotel, guestId: guest, status: 'confirmed', accessToken: randomUUID(), ...money }).returning();
		const [b] = await db
			.insert(s.bookings)
			.values({ hotelId: hotel, orderId: o!.id, status: 'confirmed', checkIn: '2031-06-01', checkOut: '2031-06-03', occupancy: guests, ...money })
			.returning();
		await db.insert(s.bookingRooms).values({ bookingId: b!.id, roomTypeId, ratePlanId: plan, quantity: rooms } as never);
		return { bookingId: b!.id, roomIds, code: o!.id.slice(0, 8).toUpperCase() };
	}

	const onHand = async (itemId: string) => (await stock.listStock(hotel)).find((r) => r.id === itemId)!.onHandMilli;
	const pcs = (n: number) => n * 1000;

	beforeAll(async () => {
		hotel = await mkHotel('a');
		const [t] = await db.insert(s.roomTypes).values({ hotelId: hotel, name: 'Deluxe' }).returning();
		deluxe = t!.id;
		const [t2] = await db.insert(s.roomTypes).values({ hotelId: hotel, name: 'Plain' }).returning();
		plain = t2!.id;
		const [p] = await db.insert(s.ratePlans).values({ hotelId: hotel, roomTypeId: deluxe, name: 'Std', basePriceCentavos: 100_000 }).returning();
		plan = p!.id;
		const [g] = await db.insert(s.guests).values({ hotelId: hotel, fullName: 'Juan Dela Cruz', email: 'jdc@example.com' }).returning();
		guest = g!.id;

		const mk = (name: string, department: 'hotel') =>
			stock.createStockItem(hotel, { name, department, kind: 'consumable', unit: 'pcs', reorderLevelMilli: null }, null);
		soap = await mk('Bath soap', 'hotel');
		brush = await mk('Toothbrush', 'hotel');
		await stock.receiveStock({ hotelId: hotel, itemId: soap, qtyMilli: pcs(100), actor: null });
		await stock.receiveStock({ hotelId: hotel, itemId: brush, qtyMilli: pcs(100), actor: null });
		await stock.setKit(
			hotel,
			deluxe,
			[
				{ stockItemId: soap, qtyMilli: pcs(1), per: 'room' },
				{ stockItemId: brush, qtyMilli: pcs(1), per: 'guest' }
			],
			null
		);
	});

	afterAll(async () => {
		if (!hotelIds.length) return;
		// Bookings first: booking_rooms RESTRICTs a rate plan's delete, so a hotel cascade alone fails.
		await db.delete(s.bookings).where(inArray(s.bookings.hotelId, hotelIds));
		await db.delete(s.orders).where(inArray(s.orders.hotelId, hotelIds));
		await db.delete(s.auditLog).where(inArray(s.auditLog.hotelId, hotelIds));
		await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
	});

	it('scales the kit per room and per guest', async () => {
		const { bookingId } = await mkBooking(deluxe, 2, 5);
		const kit = await stock.suggestedKit(hotel, bookingId);
		expect(Object.fromEntries(kit.map((k) => [k.name, k.qtyMilli]))).toEqual({ 'Bath soap': pcs(2), Toothbrush: pcs(5) });
	});

	it('takes what staff confirmed at check-in, tagged with the booking code and guest', async () => {
		const { bookingId, roomIds, code } = await mkBooking(deluxe, 1, 2);
		const s0 = await onHand(soap);
		const b0 = await onHand(brush);
		// Staff gave one toothbrush fewer than the kit suggested.
		await fd.checkInBooking(hotel, bookingId, roomIds, null, null, null, [
			{ stockItemId: soap, qtyMilli: pcs(1) },
			{ stockItemId: brush, qtyMilli: pcs(1) }
		]);
		expect(await onHand(soap)).toBe(s0 - pcs(1));
		expect(await onHand(brush)).toBe(b0 - pcs(1));
		const moves = await db.select().from(s.stockMovements).where(eq(s.stockMovements.bookingId, bookingId));
		expect(moves.every((m) => m.type === 'checkin_kit' && m.note === `Check-in ${code} · Juan Dela Cruz`)).toBe(true);
	});

	it('a room type with no kit suggests nothing, and a failed check-in takes nothing', async () => {
		const empty = await mkBooking(plain, 1, 2);
		expect(await stock.suggestedKit(hotel, empty.bookingId)).toEqual([]);

		const { bookingId } = await mkBooking(deluxe, 1, 1);
		const s0 = await onHand(soap);
		// Wrong number of rooms picked → check-in refused, so the kit must roll back with it.
		await expect(fd.checkInBooking(hotel, bookingId, [], null, null, null, [{ stockItemId: soap, qtyMilli: pcs(1) }])).rejects.toThrow(
			fd.CheckInError
		);
		expect(await onHand(soap)).toBe(s0);
	});

	it('refuses linens in a kit, and a room type from another hotel', async () => {
		const towel = await stock.createStockItem(hotel, { name: 'Bath towel', department: 'hotel', kind: 'reusable', unit: 'pcs', reorderLevelMilli: null }, null);
		await expect(stock.setKit(hotel, deluxe, [{ stockItemId: towel, qtyMilli: pcs(1), per: 'room' }], null)).rejects.toThrow(/reusable/);
		const other = await mkHotel('b');
		const [t] = await db.insert(s.roomTypes).values({ hotelId: other, name: 'Theirs' }).returning();
		await expect(stock.setKit(hotel, t!.id, [], null)).rejects.toThrow(/room type was not found/);
	});
});
