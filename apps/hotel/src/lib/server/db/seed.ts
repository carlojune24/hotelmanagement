import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ulid } from 'ulid';
import { seedHotelAmenities } from '../amenities/catalog';
import * as schema from './schema/index';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: 'snake_case' });

const argon = { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 } as const;
const pepper = process.env.AUTH_PEPPER ?? '';
const hashPw = (pw: string) => hash(pw + pepper, argon);

const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';
const MANAGER_EMAIL = (process.env.SEED_MANAGER_EMAIL ?? 'manager@example.com').toLowerCase();
const MANAGER_PW = process.env.SEED_MANAGER_PASSWORD ?? 'manager12345';
const HOTEL_SLUG = process.env.SEED_HOTEL_SLUG ?? 'hotel1';

async function upsertUser(input: {
	email: string;
	name: string;
	password: string;
	isPlatformAdmin: boolean;
}) {
	const existing = await db
		.select()
		.from(schema.users)
		.where(eq(schema.users.email, input.email))
		.then((r) => r.at(0));
	const passwordHash = await hashPw(input.password);
	if (existing) {
		await db
			.update(schema.users)
			.set({ name: input.name, passwordHash, isPlatformAdmin: input.isPlatformAdmin })
			.where(eq(schema.users.id, existing.id));
		return existing.id;
	}
	const [row] = await db
		.insert(schema.users)
		.values({
			email: input.email,
			name: input.name,
			passwordHash,
			isPlatformAdmin: input.isPlatformAdmin
		})
		.returning({ id: schema.users.id });
	return row!.id;
}

/**
 * Idempotent demo inventory for the seed hotel: two room types (with codes,
 * categories, gallery photos), a handful of rooms exercising every operational
 * status / flag, and rate plans covering weekend pricing, child rules, extra-bed
 * fees, min/max stay, and a seasonal range. Skipped once room types exist.
 */
async function seedInventory(hotelId: string) {
	const existing = await db
		.select({ id: schema.roomTypes.id })
		.from(schema.roomTypes)
		.where(eq(schema.roomTypes.hotelId, hotelId))
		.limit(1);
	if (existing.length > 0) return;

	// Link master amenities (seeded separately) to a room type by slug; the first
	// few are flagged as highlighted so they surface on the room card.
	const linkAmenities = async (roomTypeId: string, slugs: string[]) => {
		const rows = await db
			.select({ id: schema.amenities.id, slug: schema.amenities.slug })
			.from(schema.amenities)
			.where(eq(schema.amenities.hotelId, hotelId));
		const bySlug = new Map(rows.map((r) => [r.slug, r.id]));
		const links = slugs
			.map((slug, i) => {
				const amenityId = bySlug.get(slug);
				return amenityId
					? { hotelId, roomTypeId, amenityId, isHighlighted: i < 3, sortOrder: i }
					: null;
			})
			.filter((v): v is NonNullable<typeof v> => v !== null);
		if (links.length > 0) await db.insert(schema.roomTypeAmenities).values(links);
	};

	const [deluxe] = await db
		.insert(schema.roomTypes)
		.values({
			hotelId,
			name: 'Deluxe King',
			code: 'DLX-K',
			category: 'deluxe',
			description: 'Spacious king room with city views and a work desk.',
			photos: [
				{ url: 'https://example.com/photos/deluxe-king-1.jpg', tag: 'cover' },
				{ url: 'https://example.com/photos/deluxe-king-2.jpg', tag: 'bathroom' }
			],
			baseOccupancy: 2,
			maxOccupancy: 3,
			maxAdults: 2,
			maxChildren: 1,
			extraBedAllowed: true,
			maxExtraBeds: 1,
			sizeSqm: 32,
			bedConfiguration: [{ type: 'King', quantity: 1 }],
			viewType: 'city_view'
		})
		.returning({ id: schema.roomTypes.id });

	const [standard] = await db
		.insert(schema.roomTypes)
		.values({
			hotelId,
			name: 'Standard Twin',
			code: 'STD-T',
			category: 'standard',
			description: 'Comfortable twin room, ideal for friends or colleagues.',
			photos: [{ url: 'https://example.com/photos/standard-twin-1.jpg', tag: 'cover' }],
			baseOccupancy: 2,
			maxOccupancy: 2,
			maxAdults: 2,
			maxChildren: 0,
			sizeSqm: 24,
			bedConfiguration: [{ type: 'Twin', quantity: 2 }],
			viewType: 'garden_view'
		})
		.returning({ id: schema.roomTypes.id });

	await linkAmenities(deluxe!.id, [
		'free-wifi',
		'air-conditioning',
		'flat-screen-tv',
		'minibar',
		'in-room-safe',
		'coffee-tea-maker'
	]);
	await linkAmenities(standard!.id, ['free-wifi', 'air-conditioning', 'flat-screen-tv']);

	await db.insert(schema.rooms).values([
		{ hotelId, roomTypeId: deluxe!.id, roomNumber: '301', floor: '3', isConnecting: true },
		{ hotelId, roomTypeId: deluxe!.id, roomNumber: '302', floor: '3', isConnecting: true },
		{
			hotelId,
			roomTypeId: deluxe!.id,
			roomNumber: '303',
			floor: '3',
			operationalStatus: 'under_maintenance',
			notes: 'AC compressor replacement scheduled'
		},
		{ hotelId, roomTypeId: standard!.id, roomNumber: '201', floor: '2' },
		{ hotelId, roomTypeId: standard!.id, roomNumber: '202', floor: '2' },
		{
			hotelId,
			roomTypeId: standard!.id,
			roomNumber: '203',
			floor: '2',
			isActive: false,
			notes: 'Held for long-stay renovation'
		}
	]);

	const [flexPolicy] = await db
		.insert(schema.cancellationPolicies)
		.values({
			hotelId,
			name: 'Flexible',
			description: 'Free cancellation up to 48 hours before check-in.',
			freeCancelHours: 48,
			penaltyType: 'first_night'
		})
		.returning({ id: schema.cancellationPolicies.id });

	const [bar] = await db
		.insert(schema.ratePlans)
		.values({
			hotelId,
			roomTypeId: deluxe!.id,
			cancellationPolicyId: flexPolicy!.id,
			name: 'Best Available Rate',
			description: 'Our standard flexible rate.',
			inclusions: ['Breakfast'],
			basePriceCentavos: 450_000,
			weekendPriceCentavos: 520_000,
			weekendDays: [5, 6],
			extraPersonFeeCentavos: 80_000,
			extraChildFeeCentavos: 40_000,
			childFreeMaxAge: 5,
			extraBedFeeCentavos: 60_000,
			depositCentavos: 100_000,
			minStayNights: 1,
			maxStayNights: 14
		})
		.returning({ id: schema.ratePlans.id });

	await db.insert(schema.ratePlans).values({
		hotelId,
		roomTypeId: standard!.id,
		cancellationPolicyId: flexPolicy!.id,
		name: 'Best Available Rate',
		inclusions: [],
		basePriceCentavos: 280_000,
		weekendPriceCentavos: 320_000,
		extraPersonFeeCentavos: 60_000
	});

	await db.insert(schema.seasonalRates).values({
		hotelId,
		ratePlanId: bar!.id,
		name: 'Holiday season',
		startDate: '2026-12-20',
		endDate: '2027-01-03',
		multiplierBps: 13_000,
		minStayNights: 2
	});
}

/** Idempotent property-wide amenity picks for the seed hotel's storefront "About" section. */
async function seedHotelAmenityLinks(hotelId: string) {
	const existing = await db
		.select({ id: schema.hotelAmenities.id })
		.from(schema.hotelAmenities)
		.where(eq(schema.hotelAmenities.hotelId, hotelId))
		.limit(1);
	if (existing.length > 0) return;

	const rows = await db
		.select({ id: schema.amenities.id, slug: schema.amenities.slug })
		.from(schema.amenities)
		.where(eq(schema.amenities.hotelId, hotelId));
	const bySlug = new Map(rows.map((r) => [r.slug, r.id]));

	const picks: Array<{ slug: string; note?: string }> = [
		{ slug: 'front-desk-24h' },
		{ slug: 'free-wifi' },
		{ slug: 'swimming-pool' },
		{ slug: 'parking' },
		{ slug: 'restaurant', note: 'Breakfast 6–10am, dinner 6–10pm' },
		{ slug: 'security-24h' },
		{ slug: 'elevator' }
	];
	const links = picks
		.map((p, i) => {
			const amenityId = bySlug.get(p.slug);
			return amenityId
				? { hotelId, amenityId, note: p.note, sortOrder: i }
				: null;
		})
		.filter((v): v is NonNullable<typeof v> => v !== null);
	if (links.length > 0) await db.insert(schema.hotelAmenities).values(links);
}

async function main() {
	const adminId = await upsertUser({
		email: ADMIN_EMAIL,
		name: 'Platform Admin',
		password: ADMIN_PW,
		isPlatformAdmin: true
	});

	const managerId = await upsertUser({
		email: MANAGER_EMAIL,
		name: 'Hotel Manager',
		password: MANAGER_PW,
		isPlatformAdmin: false
	});

	let hotel = await db
		.select()
		.from(schema.hotels)
		.where(eq(schema.hotels.slug, HOTEL_SLUG))
		.then((r) => r.at(0));

	if (!hotel) {
		const [row] = await db
			.insert(schema.hotels)
			.values({
				slug: HOTEL_SLUG,
				name: 'Demo Hotel',
				legalName: 'Demo Hotel Corp.',
				orgRef: `org_${ulid()}`,
				city: 'Manila',
				timezone: 'Asia/Manila',
				status: 'published',
				config: {
					branding: {
						tagline: 'A quiet stay in the middle of the city.',
						about:
							'Demo Hotel sits a short walk from the bay, with rooms built for both a weekend trip and a longer work stay. Every rate you see here is the same one our front desk quotes — no third-party markup.'
					}
				}
			})
			.returning();
		hotel = row!;
	}

	await db
		.insert(schema.memberships)
		.values({ userId: managerId, hotelId: hotel.id, role: 'hotel_admin' })
		.onConflictDoUpdate({
			target: [schema.memberships.userId, schema.memberships.hotelId],
			set: { role: 'hotel_admin' }
		});

	await seedHotelAmenities(db, hotel.id);
	await seedHotelAmenityLinks(hotel.id);
	await seedInventory(hotel.id);

	console.log('Seed complete:');
	console.log(`  Platform admin : ${ADMIN_EMAIL} / ${ADMIN_PW}  -> /admin`);
	console.log(`  Hotel manager  : ${MANAGER_EMAIL} / ${MANAGER_PW}  -> /${HOTEL_SLUG}/dashboard`);
	console.log(`  Demo hotel     : /${HOTEL_SLUG}  (${hotel.orgRef})`);
	void adminId;
}

main()
	.then(() => client.end())
	.catch(async (e) => {
		console.error(e);
		await client.end();
		process.exit(1);
	});
