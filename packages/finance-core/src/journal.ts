/**
 * @mm/finance-core/journal — the double-entry journal contract every MM app posts
 * to. `cashMovementCategory` is copied verbatim from the hotel app's
 * `schema/finance.ts` `cash_category` pgEnum — keep the two in sync; this is the
 * source of truth for what a producing app's cash-movement categories may be.
 */
import { z } from 'zod';
import { orgRef, accountRef, amountMinor, currency, plainDate } from '@mm/integration';

/** Closed taxonomy of what a cash movement represents. Additive only — must stay a
 *  verbatim mirror of the hotel app's `cash_category` pgEnum. */
export const cashMovementCategory = z.enum([
	'room_revenue',
	'hall_revenue',
	'incidental_sale',
	'deposit',
	'deposit_refund',
	'refund',
	'other_revenue',
	'expense',
	'payroll',
	'statutory_remittance',
	'bank_deposit',
	'transfer_in',
	'transfer_out',
	'owner_contribution',
	'owner_draw',
	'adjustment'
]);
export type CashMovementCategory = z.infer<typeof cashMovementCategory>;

export const cashDirection = z.enum(['in', 'out']);
export type CashDirection = z.infer<typeof cashDirection>;

export const journalDimensions = z.object({
	org_ref: orgRef,
	hotel_id: z.string().uuid(),
	department: z.string().nullable().optional(),
	cost_center: z.string().nullable().optional(),
	project: z.string().nullable().optional()
});
export type JournalDimensions = z.infer<typeof journalDimensions>;

export const journalLine = z.object({
	account_ref: accountRef,
	debit_minor: amountMinor,
	credit_minor: amountMinor,
	currency,
	dimensions: journalDimensions
});
export type JournalLine = z.infer<typeof journalLine>;

export const journalEntryDraft = z.object({
	date: plainDate,
	memo: z.string().nullable().optional(),
	source_type: z.string(),
	source_ref: z.string().nullable().optional(),
	lines: z.array(journalLine).min(2)
});
export type JournalEntryDraft = z.infer<typeof journalEntryDraft>;

/** Throws if a draft's debit and credit legs don't sum to the same total, or if any
 *  line has both/neither leg populated. Every app's posting layer must run drafts
 *  through this before writing them — it's the one piece of real logic every MM app
 *  needs identically, so it lives here rather than being reimplemented per app. */
export function assertBalanced(draft: JournalEntryDraft): void {
	let debits = 0;
	let credits = 0;
	for (const line of draft.lines) {
		const hasDebit = line.debit_minor > 0;
		const hasCredit = line.credit_minor > 0;
		if (hasDebit === hasCredit) {
			throw new Error('Each journal line must have exactly one of debit_minor or credit_minor set.');
		}
		debits += line.debit_minor;
		credits += line.credit_minor;
	}
	if (debits !== credits) {
		throw new Error(`Journal entry does not balance: debits=${debits} credits=${credits}.`);
	}
}
