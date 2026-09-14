import { and, eq, inArray, lt } from 'drizzle-orm';
import { db } from '../db/index';
import { bookings, hotels } from '../db/schema/index';
import { expirePendingOrders } from '../orders';
import { generateDueRecurringExpenses } from '../finance/expenses';
import { markNoShow } from '../cancellation';
import { businessDateFor } from '../finance/shared';
import { getEnabledHotelIds } from './toggles';

export interface JobRunSummary {
	hotelsProcessed: number;
	detail: Record<string, number>;
}

/** Cancels stale pending-payment bookings, per hotel that has `hold_sweep` on. */
export async function runHoldSweep(): Promise<JobRunSummary> {
	const hotelIds = await getEnabledHotelIds('hold_sweep');
	let expired = 0;
	for (const hotelId of hotelIds) {
		const result = await expirePendingOrders({ hotelId, reason: 'Expired — night audit hold sweep' });
		expired += result.expiredOrderIds.length;
	}
	return { hotelsProcessed: hotelIds.length, detail: { expiredOrders: expired } };
}

/** Generates every due recurring expense, per hotel that has `recurring_expenses` on. */
export async function runRecurringExpenses(): Promise<JobRunSummary> {
	const hotelIds = await getEnabledHotelIds('recurring_expenses');
	if (hotelIds.length === 0) return { hotelsProcessed: 0, detail: { created: 0 } };

	const rows = await db
		.select({ id: hotels.id, timezone: hotels.timezone })
		.from(hotels)
		.where(inArray(hotels.id, hotelIds));

	let created = 0;
	for (const h of rows) {
		const result = await generateDueRecurringExpenses(h.id, businessDateFor(h.timezone), null);
		created += result.created;
	}
	return { hotelsProcessed: rows.length, detail: { created } };
}

/** Flips a confirmed arrival to `no_show` once its check-in date has fully passed
 *  with no check-in, per hotel that has `no_show_autoflag` on. Uses each hotel's
 *  own business date (its own timezone), same as every other dated Finance/
 *  front-desk rule in this app. */
export async function runNoShowAutoflag(): Promise<JobRunSummary> {
	const hotelIds = await getEnabledHotelIds('no_show_autoflag');
	if (hotelIds.length === 0) return { hotelsProcessed: 0, detail: { flagged: 0 } };

	const rows = await db
		.select({ id: hotels.id, timezone: hotels.timezone })
		.from(hotels)
		.where(inArray(hotels.id, hotelIds));

	let flagged = 0;
	for (const h of rows) {
		const today = businessDateFor(h.timezone);
		const candidates = await db
			.select({ id: bookings.id })
			.from(bookings)
			.where(and(eq(bookings.hotelId, h.id), eq(bookings.status, 'confirmed'), lt(bookings.checkIn, today)));
		for (const c of candidates) {
			// markNoShow re-checks status under a guarded update, so a race (e.g. staff
			// checking the guest in seconds before this runs) simply no-ops there.
			try {
				await markNoShow(h.id, c.id, null);
				flagged++;
			} catch {
				// Already moved on (checked in, cancelled, etc.) between the select above
				// and here — not an error condition for a sweep.
			}
		}
	}
	return { hotelsProcessed: rows.length, detail: { flagged } };
}
