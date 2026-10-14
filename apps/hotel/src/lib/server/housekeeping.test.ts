import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Live-DB tests for housekeeping's "No damages" sign-off: it records a fact against the right
 * stay, refuses while a damage report is open, is idempotent, is superseded by a later report,
 * stays inside its hotel — and leaves cleanliness and the deposit rules alone. Own throwaway
 * hotels, removed afterwards; skipped when no DATABASE_URL is configured.
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

describe.skipIf(!hasDb)('housekeeping: no damages sign-off (live DB)', async () => {
	const { db } = await import('$lib/server/db/index');
	const s = await import('$lib/server/db/schema/index');
	const { mintRef } = await import('$lib/server/ids');
	const hk = await import('./housekeeping');

	const tag = `hktest-${Math.random().toString(36).slice(2, 8)}`;
	const hotelIds: string[] = [];
	let hotelA = '';
	let hotelB = '';
	let userId = '';
	let typeA = '';
	let guestA = '';
	let roomSeq = 100;

	async function mkHotel(suffix: string) {
		const [h] = await db
			.insert(s.hotels)
			.values({ slug: `${tag}-${suffix}`, name: `HK ${suffix}`, orgRef: mintRef('org') })
			.returning({ id: s.hotels.id });
		hotelIds.push(h!.id);
		return h!.id;
	}
	const actor = () => ({ id: userId, email: 'hk@example.test', name: 'Rosa Cleaner', isPlatformAdmin: false }) as never;

	/** A room with one booking in it (checked in or checked out), assigned to the room. */
	async function mkStay(status: 'checked_in' | 'checked_out') {
		const [room] = await db
			.insert(s.rooms)
			.values({ hotelId: hotelA, roomTypeId: typeA, roomNumber: String(roomSeq++) })
			.returning();
		const [o] = await db
			.insert(s.orders)
			.values({
				hotelId: hotelA,
				guestId: guestA,
				status: 'confirmed',
				subtotalCentavos: 100_000,
				feesCentavos: 0,
				vatCentavos: 12_000,
				totalCentavos: 112_000,
				accessToken: randomUUID()
			})
			.returning();
		const [b] = await db
			.insert(s.bookings)
			.values({
				hotelId: hotelA,
				orderId: o!.id,
				status,
				checkIn: '2031-06-01',
				checkOut: '2031-06-03',
				occupancy: 2,
				subtotalCentavos: 100_000,
				feesCentavos: 0,
				vatCentavos: 12_000,
				totalCentavos: 112_000
			})
			.returning();
		const [br] = await db
			.insert(s.bookingRooms)
			.values({ bookingId: b!.id, roomTypeId: typeA, ratePlanId: await planId(), quantity: 1 } as never)
			.returning();
		await db.insert(s.roomAssignments).values({
			bookingRoomId: br!.id,
			roomId: room!.id,
			checkIn: '2031-06-01',
			checkOut: '2031-06-03'
		});
		return { roomId: room!.id, bookingId: b!.id };
	}
	let cachedPlan = '';
	async function planId() {
		if (cachedPlan) return cachedPlan;
		const [p] = await db
			.insert(s.ratePlans)
			.values({ hotelId: hotelA, roomTypeId: typeA, name: 'Std', basePriceCentavos: 100_000 })
			.returning();
		cachedPlan = p!.id;
		return cachedPlan;
	}

	const inspections = (roomId: string) =>
		db.select().from(s.housekeepingInspections).where(eq(s.housekeepingInspections.roomId, roomId));
	const statusOf = async (roomId: string) =>
		(await db.select().from(s.housekeepingStatus).where(eq(s.housekeepingStatus.roomId, roomId)))[0];

	beforeAll(async () => {
		hotelA = await mkHotel('a');
		hotelB = await mkHotel('b');
		const [u] = await db
			.insert(s.users)
			.values({ email: `${tag}@example.test`, name: 'Rosa Cleaner', passwordHash: null })
			.returning({ id: s.users.id });
		userId = u!.id;
		const [t] = await db.insert(s.roomTypes).values({ hotelId: hotelA, name: 'Deluxe' }).returning();
		typeA = t!.id;
		const [g] = await db.insert(s.guests).values({ hotelId: hotelA, fullName: 'Stay Guest', email: 'sg@example.com' }).returning();
		guestA = g!.id;
	});

	afterAll(async () => {
		if (hotelIds.length) {
			await db.delete(s.housekeepingDamageReports).where(inArray(s.housekeepingDamageReports.hotelId, hotelIds));
			await db.delete(s.housekeepingInspections).where(inArray(s.housekeepingInspections.hotelId, hotelIds));
			await db.delete(s.housekeepingStatus).where(inArray(s.housekeepingStatus.hotelId, hotelIds));
			await db.delete(s.auditLog).where(inArray(s.auditLog.hotelId, hotelIds));
			await db.delete(s.bookings).where(inArray(s.bookings.hotelId, hotelIds));
			await db.delete(s.orders).where(inArray(s.orders.hotelId, hotelIds));
			await db.delete(s.guests).where(inArray(s.guests.hotelId, hotelIds));
			await db.delete(s.ratePlans).where(inArray(s.ratePlans.hotelId, hotelIds));
			await db.delete(s.rooms).where(inArray(s.rooms.hotelId, hotelIds));
			await db.delete(s.roomTypes).where(inArray(s.roomTypes.hotelId, hotelIds));
			await db.delete(s.hotels).where(inArray(s.hotels.id, hotelIds));
		}
		if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
	});

	it('records the sign-off against the stay the room just had, and audits it', async () => {
		const { roomId, bookingId } = await mkStay('checked_out');
		const out = await hk.markRoomNoDamage(hotelA, roomId, { note: ' minibar restocked ' }, actor());
		expect(out).toEqual({ alreadyRecorded: false });

		const [row] = await inspections(roomId);
		expect(row).toMatchObject({ hotelId: hotelA, bookingId, result: 'no_damage', note: 'minibar restocked', inspectedByUserId: userId });

		const [audit] = await db
			.select()
			.from(s.auditLog)
			.where(and(eq(s.auditLog.hotelId, hotelA), eq(s.auditLog.action, 'housekeeping.no_damage'), eq(s.auditLog.entityId, roomId)));
		expect(audit!.after).toMatchObject({ bookingId, note: 'minibar restocked' });
	});

	it('is a record only: it neither cleans the room nor touches anything else', async () => {
		const { roomId } = await mkStay('checked_out');
		await hk.flagRoomForHousekeeping(hotelA, roomId, 'checkout', null, actor());
		expect((await statusOf(roomId))!.status).toBe('dirty');
		await hk.markRoomNoDamage(hotelA, roomId, {}, actor());
		expect((await statusOf(roomId))!.status).toBe('dirty');
		expect((await hk.getRoomHousekeepingOverlay(hotelA, [roomId])).get(roomId)!.pendingDamageReports).toEqual([]);
	});

	it('is idempotent for the same stay', async () => {
		const { roomId } = await mkStay('checked_out');
		expect((await hk.markRoomNoDamage(hotelA, roomId, {}, actor())).alreadyRecorded).toBe(false);
		expect((await hk.markRoomNoDamage(hotelA, roomId, {}, actor())).alreadyRecorded).toBe(true);
		expect(await inspections(roomId)).toHaveLength(1);
	});

	it('refuses while a damage report is waiting for front desk, and works again once it is dismissed', async () => {
		const { roomId } = await mkStay('checked_in');
		const { damageReportId } = await hk.reportRoomDamage(hotelA, roomId, { description: 'Cracked mirror', photoUrl: '/uploads/x.jpg' }, actor());
		await expect(hk.markRoomNoDamage(hotelA, roomId, {}, actor())).rejects.toThrow(/damage report.*waiting/i);
		expect(await inspections(roomId)).toHaveLength(0);

		await hk.dismissDamageReport(hotelA, damageReportId, actor());
		expect((await hk.markRoomNoDamage(hotelA, roomId, {}, actor())).alreadyRecorded).toBe(false);
	});

	it('stops counting as "no damage" once a report is filed after it', async () => {
		const { roomId } = await mkStay('checked_out');
		await hk.markRoomNoDamage(hotelA, roomId, {}, actor());
		expect((await hk.getLatestRoomInspections(hotelA, [roomId])).has(roomId)).toBe(true);

		await new Promise((r) => setTimeout(r, 15));
		await hk.reportRoomDamage(hotelA, roomId, { description: 'Stain on the carpet', photoUrl: '/uploads/y.jpg' }, actor());
		expect((await hk.getLatestRoomInspections(hotelA, [roomId])).has(roomId)).toBe(false);
		expect((await hk.getHousekeepingRoomDetail(hotelA, roomId)).inspection).toBeNull();
	});

	it("shows the sign-off with who did it in the room's detail", async () => {
		const { roomId } = await mkStay('checked_out');
		await hk.markRoomNoDamage(hotelA, roomId, { note: 'all good' }, actor());
		const detail = await hk.getHousekeepingRoomDetail(hotelA, roomId);
		expect(detail.inspection).toMatchObject({ inspectedByName: 'Rosa Cleaner', note: 'all good' });
	});

	it("stays inside its hotel: another hotel's room cannot be signed off", async () => {
		const { roomId } = await mkStay('checked_out');
		await expect(hk.markRoomNoDamage(hotelB, roomId, {}, actor())).rejects.toThrow(/room not found/i);
		await expect(hk.markRoomNoDamage(hotelA, randomUUID(), {}, actor())).rejects.toThrow(/room not found/i);
		expect((await hk.getLatestRoomInspections(hotelB, [roomId])).size).toBe(0);
	});
});
