/**
 * Loads DUMMY payments for the demo hotels into the CITY database, so the income report has data.
 * Run after `city:seed:demo`:
 *
 *   pnpm --filter @mm/hotel city:seed:income
 *
 * Why this isn't just `recordPayment`: that function stamps every payment with *today*, which would put
 * 14 months of income on one day. So each payment is written the way `recordOrderPayment` writes it
 * (a `payments` row, a `payment_allocations` row, a folio) but the money itself goes through the app's real
 * cash choke point, `recordCashMovement`, with a back-dated business date. That is what keeps the cash
 * account balances and the double-entry ledger correct. Nothing is edited by hand afterwards.
 *
 * Only `demo-*` hotels are touched, and only on a `*_city` database (see ./city-env). Safe to re-run:
 * bookings that already have a payment are skipped.
 */
import './city-env';
import { and, eq, isNull, like, sql } from 'drizzle-orm';
import { DEMO_SLUG_PREFIX, mulberry32 } from '../src/lib/city/demo-data';

const { db } = await import('$lib/server/db/index');
const schema = await import('$lib/server/db/schema/index');
const { recordCashMovement } = await import('$lib/server/finance/cash');
const { getFinanceSettings } = await import('$lib/server/finance/settings');
const { seedFinanceDefaults } = await import('$lib/server/finance/seed-defaults');
const { ensureFolio } = await import('$lib/server/folio');

const { hotels, bookings, orders, guests, payments, paymentAllocations } = schema;

type Method = 'cash' | 'card' | 'gcash' | 'maya' | 'bank_transfer';
const METHODS: [Method, number][] = [
	['cash', 0.4],
	['gcash', 0.25],
	['card', 0.15],
	['bank_transfer', 0.1],
	['maya', 0.1]
];
const pickMethod = (r: number): Method => {
	let acc = 0;
	for (const [m, w] of METHODS) if (r < (acc += w)) return m;
	return 'cash';
};

const todayManila = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const capToday = (d: string) => (d > todayManila ? todayManila : d);
/** Noon in Manila on a business date. */
const noon = (d: string) => new Date(`${d}T04:00:00Z`);

const rng = mulberry32(777);
let paymentCount = 0;
let refundCount = 0;

async function main() {
	const demoHotels = await db
		.select({ id: hotels.id, slug: hotels.slug })
		.from(hotels)
		.where(like(hotels.slug, `${DEMO_SLUG_PREFIX}%`));
	if (demoHotels.length === 0) throw new Error('No demo hotels found — run city:seed:demo first.');

	// Each demo hotel needs cash accounts (drawer, bank…) before it can take money.
	for (const h of demoHotels) await seedFinanceDefaults(db, h.id);

	const accountsOf = new Map<string, { drawer: string; bank: string }>();
	for (const h of demoHotels) {
		const s = await getFinanceSettings(h.id);
		if (!s.defaultDrawerAccountId || !s.defaultBankAccountId) throw new Error(`${h.slug}: finance accounts missing`);
		accountsOf.set(h.id, { drawer: s.defaultDrawerAccountId, bank: s.defaultBankAccountId });
	}

	// Bookings not yet paid for (a payment is allocated to a booking).
	const todo = await db
		.select({
			bookingId: bookings.id,
			hotelId: bookings.hotelId,
			orderId: bookings.orderId,
			status: bookings.status,
			checkIn: bookings.checkIn,
			total: bookings.totalCentavos,
			createdAt: bookings.createdAt,
			guest: guests.fullName
		})
		.from(bookings)
		.innerJoin(hotels, eq(hotels.id, bookings.hotelId))
		.innerJoin(orders, eq(orders.id, bookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.leftJoin(paymentAllocations, eq(paymentAllocations.bookingId, bookings.id))
		.where(and(like(hotels.slug, `${DEMO_SLUG_PREFIX}%`), isNull(paymentAllocations.id)));

	console.log(`${todo.length} unpaid demo bookings to process…`);

	const bookedOn = (b: (typeof todo)[number]) => capToday(new Date(b.createdAt).toISOString().slice(0, 10));

	async function pay(
		b: (typeof todo)[number],
		o: { amount: number; purpose: 'deposit' | 'settlement'; on: string; method: Method }
	) {
		const acc = accountsOf.get(b.hotelId)!;
		const cashAccountId = o.method === 'cash' ? acc.drawer : acc.bank;
		const paidAt = noon(o.on);
		await db.transaction(async (tx) => {
			await ensureFolio(tx, b.hotelId, { kind: 'room', bookingId: b.bookingId });
			const [row] = await tx
				.insert(payments)
				.values({
					orderId: b.orderId,
					provider: 'cash',
					method: o.method,
					purpose: o.purpose,
					status: 'paid',
					amountCentavos: o.amount,
					cashAccountId,
					tenderedCentavos: o.method === 'cash' ? o.amount : null,
					changeCentavos: 0,
					referenceNo: o.method === 'cash' ? null : `REF-${Math.floor(rng() * 9e6 + 1e6)}`,
					paidAt
				})
				.returning({ id: payments.id });
			await tx.insert(paymentAllocations).values({ paymentId: row!.id, bookingId: b.bookingId, amountCentavos: o.amount });
			await recordCashMovement(
				{
					hotelId: b.hotelId,
					businessDate: o.on,
					occurredAt: paidAt,
					direction: 'in',
					category: o.purpose === 'deposit' ? 'deposit' : 'room_revenue',
					cashAccountId,
					amountCentavos: o.amount,
					counterpartyType: 'guest',
					counterpartyName: b.guest,
					sourceType: 'payment',
					sourceId: row!.id,
					paymentId: row!.id,
					memo: `Demo ${o.purpose} — room booking`
				},
				tx
			);
		});
		paymentCount++;
	}

	async function refund(b: (typeof todo)[number], amount: number, on: string, method: Method) {
		const acc = accountsOf.get(b.hotelId)!;
		const cashAccountId = method === 'cash' ? acc.drawer : acc.bank;
		const paidAt = noon(on);
		await db.transaction(async (tx) => {
			const folioId = await ensureFolio(tx, b.hotelId, { kind: 'room', bookingId: b.bookingId });
			const [row] = await tx
				.insert(payments)
				.values({
					orderId: b.orderId,
					provider: 'cash',
					method,
					purpose: 'refund',
					status: 'paid',
					amountCentavos: -amount,
					folioId,
					cashAccountId,
					referenceNo: method === 'cash' ? null : `RFD-${Math.floor(rng() * 9e6 + 1e6)}`,
					paidAt
				})
				.returning({ id: payments.id });
			await recordCashMovement(
				{
					hotelId: b.hotelId,
					businessDate: on,
					occurredAt: paidAt,
					direction: 'out',
					category: 'refund',
					cashAccountId,
					amountCentavos: amount,
					counterpartyType: 'guest',
					counterpartyName: b.guest,
					sourceType: 'payment',
					sourceId: row!.id,
					paymentId: row!.id,
					memo: 'Demo refund — cancelled booking deposit'
				},
				tx
			);
		});
		refundCount++;
	}

	let done = 0;
	for (const b of todo) {
		const method = pickMethod(rng());
		const deposit = Math.round(b.total * 0.3);

		if (b.status === 'checked_out' || b.status === 'checked_in') {
			if (b.status === 'checked_out' && rng() < 0.2) {
				// Deposit when booked, balance on arrival.
				await pay(b, { amount: deposit, purpose: 'deposit', on: capToday(bookedOn(b) < b.checkIn ? bookedOn(b) : b.checkIn), method });
				await pay(b, { amount: b.total - deposit, purpose: 'settlement', on: capToday(b.checkIn), method });
			} else {
				await pay(b, { amount: b.total, purpose: 'settlement', on: capToday(b.checkIn), method });
			}
		} else if (b.status === 'confirmed') {
			await pay(b, { amount: deposit, purpose: 'deposit', on: bookedOn(b), method });
		} else if (b.status === 'no_show') {
			await pay(b, { amount: deposit, purpose: 'deposit', on: bookedOn(b), method });
		} else if (b.status === 'cancelled' && rng() < 0.55) {
			const on = bookedOn(b);
			await pay(b, { amount: deposit, purpose: 'deposit', on, method });
			if (rng() < 0.6) await refund(b, deposit, capToday(addDays(on, 1 + Math.floor(rng() * 7))), method);
		}
		// pending_payment: nothing paid yet.

		if (++done % 500 === 0) console.log(`  …${done}/${todo.length}`);
	}

	console.log(`Recorded ${paymentCount} payments and ${refundCount} refunds.`);

	const [{ n, balance }] = (await db.execute<{ n: number; balance: string }>(sql`
		select count(*)::int n, coalesce(sum(current_balance_centavos),0)::text balance
		from cash_accounts where hotel_id in (select id from hotels where slug like ${DEMO_SLUG_PREFIX + '%'})`)) as unknown as { n: number; balance: string }[];
	console.log(`Demo cash accounts: ${n}, combined balance ₱${(Number(balance) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
}

try {
	await main();
} finally {
	process.exit(0);
}
