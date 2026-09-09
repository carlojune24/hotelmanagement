/**
 * One-time backfill: give every historical paid `payments` row a matching
 * `cash_movements` row so the Finance reports and cash-position figures aren't
 * missing pre-Finance-module activity. Idempotent — a payment that already has a
 * linked movement is skipped. Run after `db:migrate` + `db:seed`:
 *
 *   pnpm --filter @mm/hotel exec tsx scripts/backfill-cash-movements.ts
 */
import 'dotenv/config';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema/index';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: 'snake_case' });

function businessDateFor(timezone: string, at: Date): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(at);
}

async function main() {
	const hotels = await db.select().from(schema.hotels);
	let created = 0;
	let skipped = 0;

	for (const hotel of hotels) {
		const accounts = await db
			.select()
			.from(schema.cashAccounts)
			.where(eq(schema.cashAccounts.hotelId, hotel.id));
		const drawer =
			accounts.find((a) => a.kind === 'cash_drawer') ??
			accounts.find((a) => a.kind === 'petty_cash');
		const undeposited = accounts.find((a) => a.kind === 'undeposited') ?? drawer;
		if (!drawer || !undeposited) {
			console.warn(`hotel ${hotel.slug}: no cash accounts — run db:seed first, skipping`);
			continue;
		}

		const rows = await db
			.select({ payment: schema.payments, order: schema.orders })
			.from(schema.payments)
			.innerJoin(schema.orders, eq(schema.orders.id, schema.payments.orderId))
			.where(and(eq(schema.orders.hotelId, hotel.id), eq(schema.payments.status, 'paid')));

		for (const { payment, order } of rows) {
			const existing = await db
				.select({ id: schema.cashMovements.id })
				.from(schema.cashMovements)
				.where(eq(schema.cashMovements.paymentId, payment.id))
				.limit(1);
			if (existing.length > 0 || payment.voidedAt || payment.amountCentavos <= 0) {
				skipped += 1;
				continue;
			}

			const isOnline = payment.provider === 'paymongo';
			const account = isOnline ? undeposited : drawer;
			const bd = businessDateFor(hotel.timezone, payment.paidAt ?? payment.createdAt);

			// Is this order a hall booking?
			const hall = await db
				.select({ id: schema.hallBookings.id })
				.from(schema.hallBookings)
				.where(eq(schema.hallBookings.orderId, order.id))
				.limit(1);

			await db.transaction(async (tx) => {
				await tx.insert(schema.cashMovements).values({
					hotelId: hotel.id,
					businessDate: bd,
					occurredAt: payment.paidAt ?? payment.createdAt,
					direction: 'in',
					category: hall.length > 0 ? 'hall_revenue' : 'room_revenue',
					cashAccountId: account.id,
					amountCentavos: payment.amountCentavos,
					counterpartyType: 'guest',
					sourceType: 'payment',
					sourceId: payment.id,
					paymentId: payment.id,
					memo: 'Backfilled from historical payment'
				});
				await tx
					.update(schema.cashAccounts)
					.set({
						currentBalanceCentavos: sql`${schema.cashAccounts.currentBalanceCentavos} + ${payment.amountCentavos}`
					})
					.where(eq(schema.cashAccounts.id, account.id));
			});
			created += 1;
		}

		// Normalise `payments.method` for old rows still on the default.
		await db
			.update(schema.payments)
			.set({ method: 'paymongo' })
			.where(
				and(
					eq(schema.payments.provider, 'paymongo'),
					inArray(
						schema.payments.orderId,
						db
							.select({ id: schema.orders.id })
							.from(schema.orders)
							.where(eq(schema.orders.hotelId, hotel.id))
					)
				)
			);
	}

	console.log(`backfill complete — ${created} movements created, ${skipped} skipped`);
}

main()
	.then(() => client.end())
	.catch(async (e) => {
		console.error(e);
		await client.end();
		process.exit(1);
	});
