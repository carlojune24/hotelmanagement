/** Shared input rules for the Settings › Rates & Policies forms (RATES-004/005/006 in issues.md).
 *  Pure — no database. Every rule carries a readable message so a bad value tells the admin
 *  what to fix instead of the generic "check the details and try again". */
import { z } from 'zod';

/** Upper bound for any single ₱ amount entered in settings (room rate, fee, deposit, promo).
 *  Generous, but it stops a typo like ₱50,000,000 going live and keeps `amount × 100` far
 *  below the point where a bigint column overflows. Matches the cap the check-in/out fees
 *  already used. */
export const MAX_MONEY_PHP = 1_000_000;

/** Shortest promo code an admin may create — 2-character codes were trivially guessable (RATES-002). */
export const PROMO_MIN_CODE_LENGTH = 6;

/** Highest percentage-off an admin may set. Below 100 on purpose: a 100% code would send a
 *  zero-amount order to the payment provider (RATES-002). */
export const MAX_PROMO_PERCENT = 90;

export const RATE_MESSAGES = {
	moneyInvalid: 'Enter a valid amount.',
	moneyNegative: "Amounts can't be negative.",
	moneyTooBig: 'Enter an amount up to ₱1,000,000.',
	time: 'Enter a valid time between 00:00 and 23:59.',
	id: 'That item could not be found.',
	promoCodeShort: `Promo codes must be at least ${PROMO_MIN_CODE_LENGTH} characters.`,
	promoPercentTooHigh: `A percentage discount can be at most ${MAX_PROMO_PERCENT}%.`,
	promoLimit: 'Enter a whole number of 1 or more, or leave it blank for no limit.'
} as const;

const KNOWN_MESSAGES = new Set<string>(Object.values(RATE_MESSAGES));

const blankToUndef = (v: unknown) => (v === '' || v == null ? undefined : v);

/** A required ₱ amount: a finite number from 0 to `MAX_MONEY_PHP`. (Zod 4 already rejects
 *  `Infinity`/`NaN`; the missing piece was the upper bound — `1e30` used to pass.) */
export const moneyPhp = () =>
	z.coerce
		.number({ error: RATE_MESSAGES.moneyInvalid })
		.min(0, RATE_MESSAGES.moneyNegative)
		.max(MAX_MONEY_PHP, RATE_MESSAGES.moneyTooBig);

/** The same amount, but a blank field means "not provided". */
export const optMoneyPhp = z.preprocess(blankToUndef, moneyPhp().optional());

/** A usage limit (max redemptions / max per email): a whole number ≥ 1, blank = no limit. */
export const optUsageLimit = z.preprocess(
	blankToUndef,
	z.coerce
		.number({ error: RATE_MESSAGES.promoLimit })
		.int(RATE_MESSAGES.promoLimit)
		.min(1, RATE_MESSAGES.promoLimit)
		.max(1_000_000, RATE_MESSAGES.promoLimit)
		.optional()
);

/** `HH:MM` on a real 24-hour clock — `99:99` and `24:00` are rejected. */
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
export const timeOfDay = () => z.string().regex(TIME_OF_DAY, RATE_MESSAGES.time);

/** The id posted by a Remove/Delete button. A non-UUID would otherwise reach a `uuid` column
 *  and come back as a 500. */
export const recordId = () => z.string().uuid(RATE_MESSAGES.id);

/** The first readable message from a failed parse, or `fallback` when none of the issues came
 *  from the rules above (so generic zod wording never reaches the admin). */
export function friendlyIssue(error: z.ZodError, fallback: string): string {
	return error.issues.find((i) => KNOWN_MESSAGES.has(i.message))?.message ?? fallback;
}
