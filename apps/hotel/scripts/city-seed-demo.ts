/**
 * Loads DUMMY hotels, rooms, guests and bookings into the CITY database so the Guests report (and the
 * root hotel register) have realistic data to show. Reads .env.city; refuses to run against any
 * database whose name doesn't end in `_city`.
 *
 *   pnpm --filter @mm/hotel city:seed:demo    load (does nothing if demo hotels already exist)
 *   pnpm --filter @mm/hotel city:seed:clear   remove every demo hotel and everything under it
 *
 * Demo hotels are the ones whose slug starts with `demo-`. Nothing else is touched.
 */
import { config } from 'dotenv';
import { randomBytes, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { inArray, like, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import * as schema from '../src/lib/server/db/schema/index';
import {
	DEMO_HOTELS,
	DEMO_SLUG_PREFIX,
	demoGuest,
	generateDemoBookings,
	guestPoolSize,
	roomsPerType
} from '../src/lib/city/demo-data';

config({ path: '.env.city' });

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set in .env.city');
if (!/\/[^/]*_city(\?|$)/.test(url)) throw new Error('Refusing to run: DATABASE_URL is not a *_city database');

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema, casing: 'snake_case' });
const { hotels, roomTypes, ratePlans, rooms, guests, orders, bookings, bookingRooms } = schema;

const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const todayManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

async function assertCityDatabase() {
	const [row] = await db.execute<{ db: string }>(sql`select current_database() as db`);
	if (!row || !row.db.endsWith('_city')) throw new Error(`Refusing to run: connected to "${row?.db}", not a *_city database`);
	return row.db;
}

async function seed() {
	const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(hotels).where(like(hotels.slug, `${DEMO_SLUG_PREFIX}%`));
	if (existing && existing.n > 0) {
		console.log(`${existing.n} demo hotels already exist — run city:seed:clear first to reload. Nothing changed.`);
		return;
	}

	const today = todayManila();
	const plan = generateDemoBookings(today);

	await db.transaction(async (tx) => {
		const hotelRows = await tx
			.insert(hotels)
			.values(
				DEMO_HOTELS.map((h) => ({
					slug: h.slug,
					name: h.name,
					city: h.city,
					orgRef: `org_${ulid()}`,
					status: 'published' as const
				}))
			)
			.returning({ id: hotels.id, slug: hotels.slug });
		const hotelId = new Map(hotelRows.map((h) => [h.slug, h.id]));

		// Per hotel: two room types + a rate plan each, rooms numbered by floor, and a guest pool.
		const typeIds = new Map<string, [string, string]>();
		const planIds = new Map<string, [string, string]>();
		const guestIds = new Map<string, string[]>();

		for (const h of DEMO_HOTELS) {
			const hid = hotelId.get(h.slug)!;
			const types = await tx
				.insert(roomTypes)
				.values([
					{ hotelId: hid, name: 'Standard Room', baseOccupancy: 2, maxOccupancy: 3, sortOrder: 0 },
					{ hotelId: hid, name: 'Deluxe Room', baseOccupancy: 2, maxOccupancy: 4, sortOrder: 1 }
				])
				.returning({ id: roomTypes.id, name: roomTypes.name });
			const standard = types.find((t) => t.name === 'Standard Room')!.id;
			const deluxe = types.find((t) => t.name === 'Deluxe Room')!.id;
			typeIds.set(h.slug, [standard, deluxe]);

			const plans = await tx
				.insert(ratePlans)
				.values([
					{ hotelId: hid, roomTypeId: standard, name: 'Standard Rate', basePriceCentavos: h.rateCentavos },
					{ hotelId: hid, roomTypeId: deluxe, name: 'Standard Rate', basePriceCentavos: Math.round((h.rateCentavos * 1.45) / 100) * 100 }
				])
				.returning({ id: ratePlans.id, roomTypeId: ratePlans.roomTypeId });
			planIds.set(h.slug, [
				plans.find((p) => p.roomTypeId === standard)!.id,
				plans.find((p) => p.roomTypeId === deluxe)!.id
			]);

			const [nStd, nDlx] = roomsPerType(h);
			const roomRows = [
				...Array.from({ length: nStd }, (_, i) => ({ hotelId: hid, roomTypeId: standard, roomNumber: String(101 + i + Math.floor(i / 10) * 90) })),
				...Array.from({ length: nDlx }, (_, i) => ({ hotelId: hid, roomTypeId: deluxe, roomNumber: String(501 + i + Math.floor(i / 10) * 90) }))
			];
			await tx.insert(rooms).values(roomRows);

			const pool = Array.from({ length: guestPoolSize(h) }, (_, i) => ({ hotelId: hid, ...demoGuest(h.slug, i) }));
			const ids: string[] = [];
			for (const part of chunk(pool, 500)) {
				const res = await tx.insert(guests).values(part).returning({ id: guests.id, email: guests.email });
				const byEmail = new Map(res.map((g) => [g.email, g.id]));
				for (const g of part) ids.push(byEmail.get(g.email)!);
			}
			guestIds.set(h.slug, ids);
		}

		// Orders → bookings → booking_rooms, with client-generated ids so no RETURNING-order assumptions.
		const now = Date.now();
		const orderRows: (typeof orders.$inferInsert)[] = [];
		const bookingRows: (typeof bookings.$inferInsert)[] = [];
		const roomRows: (typeof bookingRooms.$inferInsert)[] = [];

		for (const b of plan) {
			const hid = hotelId.get(b.hotelSlug)!;
			const nights = Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 86_400_000);
			const subtotal = b.nightlyCentavos * nights * b.roomCount;
			const vat = Math.round(subtotal * 0.12);
			const total = subtotal + vat;
			const orderId = randomUUID();
			const bookingId = randomUUID();
			// Booked 1–30 days ahead, never in the future.
			const lead = (1 + (Math.abs(b.guestIndex * 7 + nights) % 30)) * 86_400_000;
			const createdAt = new Date(Math.min(now, Date.parse(`${b.checkIn}T04:00:00Z`) - lead));
			const orderStatus = b.status === 'cancelled' ? 'cancelled' : b.status === 'pending_payment' ? 'pending_payment' : 'confirmed';

			orderRows.push({
				id: orderId,
				hotelId: hid,
				guestId: guestIds.get(b.hotelSlug)![b.guestIndex]!,
				status: orderStatus,
				subtotalCentavos: subtotal,
				feesCentavos: 0,
				vatCentavos: vat,
				totalCentavos: total,
				accessToken: randomBytes(18).toString('hex'),
				cancelledAt: b.status === 'cancelled' ? createdAt : null,
				createdAt,
				updatedAt: createdAt
			});
			bookingRows.push({
				id: bookingId,
				hotelId: hid,
				orderId,
				checkIn: b.checkIn,
				checkOut: b.checkOut,
				occupancy: b.occupancy,
				status: b.status,
				subtotalCentavos: subtotal,
				feesCentavos: 0,
				vatCentavos: vat,
				totalCentavos: total,
				createdAt,
				updatedAt: createdAt
			});
			roomRows.push({
				bookingId,
				roomTypeId: typeIds.get(b.hotelSlug)![b.roomType],
				ratePlanId: planIds.get(b.hotelSlug)![b.roomType],
				quantity: b.roomCount
			});
		}

		for (const part of chunk(orderRows, 500)) await tx.insert(orders).values(part);
		for (const part of chunk(bookingRows, 500)) await tx.insert(bookings).values(part);
		for (const part of chunk(roomRows, 500)) await tx.insert(bookingRooms).values(part);
	});

	const summary = await db.execute<{ slug: string; status: string; n: number; guests: number }>(sql`
		select h.slug, b.status, count(*)::int n, sum(b.occupancy)::int guests
		from bookings b join hotels h on h.id = b.hotel_id
		where h.slug like ${DEMO_SLUG_PREFIX + '%'} group by 1,2 order by 1,2`);
	console.table(summary);
	console.log(`Seeded ${DEMO_HOTELS.length} demo hotels and ${plan.length} bookings (as of ${today}).`);
}

async function clear() {
	const demo = await db.select({ id: hotels.id }).from(hotels).where(like(hotels.slug, `${DEMO_SLUG_PREFIX}%`));
	if (demo.length === 0) {
		console.log('No demo hotels found. Nothing changed.');
		return;
	}
	const ids = demo.map((h) => h.id);
	await db.transaction(async (tx) => {
		const demoBookings = tx.select({ id: bookings.id }).from(bookings).where(inArray(bookings.hotelId, ids));
		await tx.delete(bookingRooms).where(inArray(bookingRooms.bookingId, demoBookings));
		await tx.delete(bookings).where(inArray(bookings.hotelId, ids));
		await tx.delete(orders).where(inArray(orders.hotelId, ids));
		await tx.delete(guests).where(inArray(guests.hotelId, ids));
		await tx.delete(ratePlans).where(inArray(ratePlans.hotelId, ids));
		await tx.delete(rooms).where(inArray(rooms.hotelId, ids));
		await tx.delete(roomTypes).where(inArray(roomTypes.hotelId, ids));
		await tx.delete(hotels).where(inArray(hotels.id, ids));
	});
	console.log(`Removed ${demo.length} demo hotels and their rooms, guests and bookings.`);
}

try {
	const name = await assertCityDatabase();
	console.log(`Database: ${name}`);
	if (process.argv[2] === 'clear') await clear();
	else await seed();
} finally {
	await client.end();
}
