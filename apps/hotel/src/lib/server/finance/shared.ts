import { db } from '../db/index';

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
