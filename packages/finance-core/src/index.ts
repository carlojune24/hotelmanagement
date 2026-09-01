/**
 * @mm/finance-core — canonical chart-of-accounts taxonomy, double-entry journal
 * model, the canonical cash-movement record, posting-rule interface, and
 * consolidated report builders.
 *
 * Phase 0: package skeleton + shared enums. Filled in by Phase 3 (cash movement,
 * COA) and Phase 5 (journal, posting rules, reports). See docs/standards/finance.md.
 */
import { z } from 'zod';

export const FINANCE_CORE_VERSION = '0.1.0' as const;

/** Top-level account nature. Fixed — never extended. */
export const accountType = z.enum(['asset', 'liability', 'equity', 'income', 'expense']);
export type AccountType = z.infer<typeof accountType>;

/**
 * Closed taxonomy of what a cash movement represents. Additive only.
 * Every producing app maps its domain events onto exactly one of these.
 */
export const cashMovementCategory = z.enum([
	'room_revenue',
	'reservation_fee',
	'deposit',
	'deposit_refund',
	'amenity_sale',
	'other_revenue',
	'expense',
	'payroll',
	'statutory_remittance',
	'cash_advance',
	'cash_advance_repayment',
	'transfer',
	'adjustment'
]);
export type CashMovementCategory = z.infer<typeof cashMovementCategory>;

export const cashDirection = z.enum(['in', 'out']);
export type CashDirection = z.infer<typeof cashDirection>;
