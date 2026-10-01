/**
 * Deterministic DUMMY data for the city instance, so the guest/visitor pages can be seen with realistic
 * shape. Pure (no DB, no `$lib` imports) so `scripts/city-seed-demo.ts` can import it under tsx and tests
 * can pin it. Every demo hotel's slug starts with `demo-`; that prefix is how `city:seed:clear` finds them.
 */

export const DEMO_SLUG_PREFIX = 'demo-';

export type DemoHotelSpec = {
	slug: string;
	name: string;
	city: string;
	rooms: number;
	/** Nightly rate of the Standard room, in centavos. */
	rateCentavos: number;
	/** Months before today the hotel started taking guests; omitted = the whole history. */
	openedMonthsAgo?: number;
	/** Relative popularity — scales how many bookings arrive. */
	demand: number;
};

export const DEMO_HOTELS: DemoHotelSpec[] = [
	{ slug: 'demo-seaside-inn', name: 'Seaside Inn (demo)', city: 'Davao City', rooms: 12, rateCentavos: 280_000, demand: 1.0 },
	{ slug: 'demo-bayview-resort', name: 'Bayview Resort (demo)', city: 'Samal Island', rooms: 40, rateCentavos: 520_000, demand: 1.15 },
	{ slug: 'demo-highland-lodge', name: 'Highland Lodge (demo)', city: 'Calinan', rooms: 18, rateCentavos: 340_000, demand: 0.7 },
	{ slug: 'demo-city-center-suites', name: 'City Center Suites (demo)', city: 'Davao City', rooms: 60, rateCentavos: 410_000, demand: 1.3 },
	{ slug: 'demo-garden-pension', name: 'Garden Pension (demo)', city: 'Toril', rooms: 8, rateCentavos: 190_000, openedMonthsAgo: 5, demand: 0.9 }
];

export type DemoStatus = 'checked_out' | 'checked_in' | 'confirmed' | 'cancelled' | 'no_show' | 'pending_payment';

export type DemoBooking = {
	hotelSlug: string;
	/** Index into the hotel's guest pool (guests repeat across stays). */
	guestIndex: number;
	/** `YYYY-MM-DD` */
	checkIn: string;
	checkOut: string;
	occupancy: number;
	roomCount: number;
	/** Which of the hotel's two room types: 0 = Standard, 1 = Deluxe. */
	roomType: 0 | 1;
	status: DemoStatus;
	nightlyCentavos: number;
};

/** Small seeded PRNG (mulberry32) — same seed, same data. */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Philippine tourism seasonality by calendar month (Jan = index 0): holiday peaks, summer, a rainy-season dip. */
const SEASON = [1.2, 0.95, 0.9, 1.2, 1.25, 0.85, 0.95, 1.1, 0.8, 0.9, 0.95, 1.45];

const pad = (n: number) => String(n).padStart(2, '0');
const toYmd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Number of guests in the pool a hotel draws repeat visitors from. */
export const guestPoolSize = (h: DemoHotelSpec) => Math.max(30, h.rooms * 3);

const roomsPerType = (h: DemoHotelSpec): [number, number] => {
	const standard = Math.ceil(h.rooms * 0.6);
	return [standard, h.rooms - standard];
};
export { roomsPerType };

/**
 * Bookings for every demo hotel from `monthsBack` months before `today` through 30 days after it.
 * Arrival rate follows seasonality, hotel demand, a gentle upward trend and day-to-day noise; statuses are
 * assigned from where the stay falls relative to `today` (past → mostly checked out, spanning today →
 * checked in, future → confirmed), with some cancellations and no-shows.
 */
export function generateDemoBookings(today: string, monthsBack = 14, seed = 20260101): DemoBooking[] {
	const rng = mulberry32(seed);
	const t = new Date(`${today}T00:00:00Z`);
	const start = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - monthsBack, 1));
	const end = addDays(t, 30);
	const out: DemoBooking[] = [];

	for (const h of DEMO_HOTELS) {
		const opened = h.openedMonthsAgo
			? new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - h.openedMonthsAgo, 1))
			: start;
		const pool = guestPoolSize(h);
		const totalDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);

		for (let i = 0; i <= totalDays; i++) {
			const day = addDays(start, i);
			if (day < opened) continue;
			const trend = 1 + (i / totalDays) * 0.25;
			const weekend = [5, 6].includes(day.getUTCDay()) ? 1.35 : 1;
			// Expected arrivals per day: ~ rooms × 0.07 at demand 1, shaped by season/trend/weekday.
			const lambda = h.rooms * 0.07 * h.demand * SEASON[day.getUTCMonth()]! * trend * weekend;
			// Poisson-ish draw
			let arrivals = 0;
			for (let p = Math.exp(-lambda), s = p, u = rng(); u > s && arrivals < 60; ) {
				arrivals++;
				p *= lambda / arrivals;
				s += p;
			}

			for (let a = 0; a < arrivals; a++) {
				const nights = 1 + Math.floor(rng() ** 1.6 * 5); // mostly 1–2, up to 5
				const roomCount = rng() < 0.82 ? 1 : rng() < 0.8 ? 2 : 3;
				const roomType: 0 | 1 = rng() < 0.65 ? 0 : 1;
				const occupancy = Math.min(roomCount * (roomType === 0 ? 3 : 4), roomCount + Math.floor(rng() * (roomCount * 2 + 1)) + (rng() < 0.3 ? 1 : 0));
				const checkIn = toYmd(day);
				const checkOut = toYmd(addDays(day, nights));
				const r = rng();
				let status: DemoStatus;
				if (checkOut < today) status = r < 0.07 ? 'cancelled' : r < 0.12 ? 'no_show' : 'checked_out';
				else if (checkIn <= today) status = r < 0.05 ? 'cancelled' : 'checked_in';
				else status = r < 0.06 ? 'cancelled' : r < 0.1 ? 'pending_payment' : 'confirmed';

				out.push({
					hotelSlug: h.slug,
					guestIndex: Math.floor(rng() * pool),
					checkIn,
					checkOut,
					occupancy: Math.max(1, occupancy),
					roomCount,
					roomType,
					status,
					nightlyCentavos: Math.round((h.rateCentavos * (roomType === 0 ? 1 : 1.45)) / 100) * 100
				});
			}
		}
	}
	return out;
}

const FIRST = ['Maria', 'Jose', 'Ana', 'Juan', 'Liza', 'Mark', 'Grace', 'Paolo', 'Ella', 'Rico', 'Carla', 'Noel', 'Jenny', 'Ramon', 'Tina', 'Dante', 'Joy', 'Luis', 'Nina', 'Arnel'];
const LAST = ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Torres', 'Flores', 'Ramos', 'Aquino', 'Villanueva', 'Castillo', 'Navarro', 'Domingo', 'Pascual'];

/** A fake but plausible guest contact; `.invalid` is a reserved TLD, so no real mailbox can exist. */
export function demoGuest(hotelSlug: string, index: number) {
	const first = FIRST[index % FIRST.length]!;
	const last = LAST[Math.floor(index / FIRST.length) % LAST.length]!;
	return {
		fullName: `${first} ${last}`,
		email: `${first}.${last}.${index}@${hotelSlug}.demo.invalid`.toLowerCase()
	};
}

// ---------------------------------------------------------------------------
// Reviews

export type DemoReview = {
	/** Index into the array returned by `generateDemoBookings` — the stay being reviewed. */
	bookingIndex: number;
	rating: 1 | 2 | 3 | 4 | 5;
	comment: string;
	/** Guest-chosen display form, e.g. "Maria S." */
	displayName: string;
	status: 'approved' | 'pending' | 'rejected';
	/** `YYYY-MM-DD` the review was submitted (after checkout, never in the future). */
	submittedOn: string;
};

/** Target mean rating per demo hotel, so the roll-up shows a believable spread. */
export const DEMO_QUALITY: Record<string, number> = {
	'demo-seaside-inn': 4.3,
	'demo-bayview-resort': 4.45,
	'demo-highland-lodge': 4.65,
	'demo-city-center-suites': 3.95,
	'demo-garden-pension': 3.6
};

const COMMENTS: Record<number, string[]> = {
	5: [
		'Spotless room, warm staff and a great breakfast. We will be back.',
		'Everything was exactly as promised. Check-in took two minutes.',
		'Lovely stay, quiet, comfortable beds and a very helpful front desk.'
	],
	4: [
		'Good value and a friendly team. The wifi was a bit slow in the evening.',
		'Clean and comfortable. Breakfast could have more choices.',
		'Nice location and room. Hot water took a while in the morning.'
	],
	3: [
		'Decent for the price, but the room felt dated and the aircon was noisy.',
		'Staff were polite; the room was smaller than the photos suggested.',
		'Okay for one night. Check-in was slow because of a queue.'
	],
	2: [
		'The room was not ready at check-in and we waited over an hour.',
		'Bathroom needed cleaning and the shower pressure was weak.'
	],
	1: [
		'Booked a deluxe room but was given a standard one with no explanation.',
		'Very noisy at night and nobody at the front desk could help.'
	]
};

/** Rough bell around `mean`, clamped to 1–5 — the sum of two uniforms gives a triangular spread. */
const drawRating = (rng: () => number, mean: number): 1 | 2 | 3 | 4 | 5 => {
	const noise = (rng() + rng() - 1) * 1.7;
	return Math.min(5, Math.max(1, Math.round(mean + noise))) as 1 | 2 | 3 | 4 | 5;
};

/**
 * About a quarter of completed stays leave a review. Recent ones are mostly still pending the hotel's
 * approval (a visible backlog); older ones are mostly approved, with a few rejected and a few that were
 * never actioned.
 */
export function generateDemoReviews(bookings: DemoBooking[], today: string, seed = 424242): DemoReview[] {
	const rng = mulberry32(seed);
	const out: DemoReview[] = [];
	const todayMs = Date.parse(`${today}T00:00:00Z`);

	bookings.forEach((b, bookingIndex) => {
		if (b.status !== 'checked_out' || b.checkOut >= today || rng() > 0.25) return;
		const rating = drawRating(rng, DEMO_QUALITY[b.hotelSlug] ?? 4);
		const options = COMMENTS[rating]!;
		const guest = demoGuest(b.hotelSlug, b.guestIndex);
		const [first, last] = guest.fullName.split(' ') as [string, string];

		const wait = 1 + Math.floor(rng() * 14);
		const submitted = Math.min(todayMs, Date.parse(`${b.checkOut}T00:00:00Z`) + wait * 86_400_000);
		const ageDays = Math.round((todayMs - submitted) / 86_400_000);
		const r = rng();
		const status: DemoReview['status'] =
			ageDays <= 10 ? (r < 0.6 ? 'pending' : 'approved') : r < 0.03 ? 'pending' : r < 0.1 ? 'rejected' : 'approved';

		out.push({
			bookingIndex,
			rating,
			comment: options[Math.floor(rng() * options.length)]!,
			displayName: `${first} ${last[0]}.`,
			status,
			submittedOn: toYmd(new Date(submitted))
		});
	});
	return out;
}
