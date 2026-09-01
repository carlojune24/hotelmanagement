/**
 * @mm/integration/primitives — foundational value types shared by every MM app.
 *
 * These are the identity, money, and time rules from `docs/standards/*.md`. Every
 * consolidatable record in HR, cashflow, and accounting is built from these.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Standard version                                                    */
/* ------------------------------------------------------------------ */

/** Bump the minor for additive changes, the major only for breaking ones. */
export const MM_STANDARD_VERSION = '1.0.0' as const;
export const MM_STANDARD_VERSION_HEADER = 'x-mm-standard-version' as const;

/* ------------------------------------------------------------------ */
/* Identifiers                                                         */
/* ------------------------------------------------------------------ */

/** App-local primary key. Always a UUID v4. */
export const uuid = z.string().uuid();
export type Uuid = z.infer<typeof uuid>;

/**
 * Stable cross-app references. Opaque strings minted once and never reused for a
 * different real-world entity. Format: `<kind>_<ULID>` (e.g. `per_01J9Z...`).
 */
const refPattern = /^[a-z]{2,6}_[0-9A-HJKMNP-TV-Z]{26}$/;

export const personRef = z.string().regex(refPattern).brand<'PersonRef'>();
export type PersonRef = z.infer<typeof personRef>;

export const orgRef = z.string().regex(refPattern).brand<'OrgRef'>();
export type OrgRef = z.infer<typeof orgRef>;

export const accountRef = z.string().regex(refPattern).brand<'AccountRef'>();
export type AccountRef = z.infer<typeof accountRef>;

export const counterpartyRef = z.string().regex(refPattern).brand<'CounterpartyRef'>();
export type CounterpartyRef = z.infer<typeof counterpartyRef>;

export const refPrefix = {
	person: 'per',
	org: 'org',
	account: 'acct',
	counterparty: 'cpty'
} as const;

/* ------------------------------------------------------------------ */
/* Source tracking — makes every ingest an idempotent upsert           */
/* ------------------------------------------------------------------ */

export const sourceApp = z.enum(['hotel', 'restaurant', 'retail', 'hr', 'finance', 'external']);
export type SourceApp = z.infer<typeof sourceApp>;

export const sourceTracking = z.object({
	/** Which MM app produced this record. */
	source_app: sourceApp,
	/** The producing app's own primary key for the record. */
	source_id: z.string().min(1)
});
export type SourceTracking = z.infer<typeof sourceTracking>;

/* ------------------------------------------------------------------ */
/* Money & time                                                        */
/* ------------------------------------------------------------------ */

/** ISO 4217. Only PHP today; kept as an enum so adding one is additive. */
export const currency = z.enum(['PHP']);
export type Currency = z.infer<typeof currency>;
export const DEFAULT_CURRENCY: Currency = 'PHP';

/**
 * Money is always an integer number of the currency's minor unit (centavos for
 * PHP). Never a float of major units. Safe-integer range is ~₱90 trillion.
 */
export const amountMinor = z
	.number()
	.int('amount must be an integer number of centavos')
	.refine(Number.isSafeInteger, 'amount exceeds safe-integer range');
export type AmountMinor = z.infer<typeof amountMinor>;

export const money = z.object({
	amount_minor: amountMinor,
	currency
});
export type Money = z.infer<typeof money>;

export const zeroMoney = (c: Currency = DEFAULT_CURRENCY): Money => ({ amount_minor: 0, currency: c });

export function addMoney(a: Money, b: Money): Money {
	if (a.currency !== b.currency) throw new Error(`currency mismatch: ${a.currency} vs ${b.currency}`);
	return { amount_minor: a.amount_minor + b.amount_minor, currency: a.currency };
}

/** UTC instant, ISO-8601 with offset. Pair with an IANA `timezone` on the org. */
export const instant = z.string().datetime({ offset: true });
export type Instant = z.infer<typeof instant>;

export const ianaTimezone = z.string().min(1);
export type IanaTimezone = z.infer<typeof ianaTimezone>;

/** Calendar date with no time component, `YYYY-MM-DD`. */
export const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type PlainDate = z.infer<typeof plainDate>;

/* ------------------------------------------------------------------ */
/* Read-API conventions                                                */
/* ------------------------------------------------------------------ */

export const cursorQuery = z.object({
	/** Opaque cursor from a previous page's `next_cursor`. */
	cursor: z.string().optional(),
	/** 1..200, default 50. */
	limit: z.coerce.number().int().min(1).max(200).default(50),
	/** Incremental sync: only records changed at/after this instant. */
	updated_since: instant.optional()
});
export type CursorQuery = z.infer<typeof cursorQuery>;

export function pageSchema<T extends z.ZodTypeAny>(item: T) {
	return z.object({
		data: z.array(item),
		next_cursor: z.string().nullable(),
		standard_version: z.literal(MM_STANDARD_VERSION)
	});
}

/** Fields every consolidatable entity carries for incremental sync. */
export const syncableMeta = z.object({
	id: uuid,
	updated_at: instant,
	deleted_at: instant.nullable().default(null)
});
export type SyncableMeta = z.infer<typeof syncableMeta>;
