import { sql, type SQLWrapper } from 'drizzle-orm';
import { db } from '../db/index';
import { hotels } from '../db/schema/index';

/** The transaction object `db.transaction(cb)` hands its callback — same derivation
 *  `lib/server/folio.ts` uses, so it stays correct whatever driver `db` is built with. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Anything the Finance module refuses to do for a business reason (not a bug):
 *  a closed day, no open shift, an overpayment on a card, a negative amount, etc.
 *  Route actions catch this and surface `.message` to the user. */
export class FinanceError extends Error {}

/** `₱1,234.50` from centavos — for error messages and audit notes (UI has its own `peso()`). */
export function pesos(centavos: number): string {
	return `₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `YYYY-MM-DD` "business date" in a hotel's own timezone — same rule as
 *  `lib/server/front-desk.ts`'s `todayInTimezone`, re-stated here so the Finance
 *  module doesn't have to import the front-desk lib (which would be a cycle). */
export function businessDateFor(timezone: string): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}

/** SQL: the calendar date of a `timestamptz` column *in the hotel's own timezone*.
 *
 *  Never compare a timestamp to `'YYYY-MM-DD'::date` directly: that cast lands on midnight in
 *  the *database session's* timezone, so on a UTC server a Manila "day" would run 08:00–08:00
 *  and X/Z-readings and daily reports would drift from the stored `business_date` on cash
 *  movements. Same correlated-lookup shape as `availability.ts`'s `hotelTomorrow`. */
export function hotelLocalDate(column: SQLWrapper, hotelId: string) {
	return sql`((${column}) at time zone (select h.timezone from ${hotels} h where h.id = ${hotelId}))::date`;
}

/** SQL predicate: `column` falls on `date` (`YYYY-MM-DD`) in the hotel's timezone. */
export function onHotelDate(column: SQLWrapper, hotelId: string, date: string) {
	return sql`${hotelLocalDate(column, hotelId)} = ${date}::date`;
}

/** SQL predicate: `column` falls on or between `from` and `to` (inclusive) in the hotel's timezone. */
export function betweenHotelDates(column: SQLWrapper, hotelId: string, from: string, to: string) {
	return sql`${hotelLocalDate(column, hotelId)} between ${from}::date and ${to}::date`;
}

/** `HH:MM` (24h, zero-padded) wall-clock time in a hotel's own timezone — same
 *  string shape a native `<input type="time">` produces, so it compares correctly
 *  with a stored cutoff via plain string comparison (`runDayClose`'s day-close
 *  cutoff check). */
export function currentTimeOfDayFor(timezone: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: timezone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(new Date());
}
