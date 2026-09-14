/**
 * @mm/finance-core/coa — the chart-of-accounts taxonomy shared by every MM app.
 *
 * `accountType` is the fixed, five-way accounting nature of a balance. `accountSubtype`
 * is the open-ended "what specifically is this" bucket — kept as a Zod enum (validated
 * at the app layer, not a Postgres `pgEnum`) because it will keep growing as new MM
 * apps (restaurant, retail, ...) add subtypes of their own, and a `pgEnum` would force
 * a migration for every addition even though the change is purely additive.
 */
import { z } from 'zod';

/** Top-level account nature. Fixed — never extended. */
export const accountType = z.enum(['asset', 'liability', 'equity', 'income', 'expense']);
export type AccountType = z.infer<typeof accountType>;

export const normalBalance = z.enum(['debit', 'credit']);
export type NormalBalance = z.infer<typeof normalBalance>;

/**
 * Closed-per-release, additive-across-releases taxonomy of what an account
 * represents. Covers every hotel `cash_movements.category` and
 * `expense_categories.group` value, plus the standard balance-sheet buckets every
 * MM app will need (AR/AP, VAT, statutory payables, equity).
 */
export const accountSubtype = z.enum([
	// Assets
	'cash_on_hand',
	'cash_in_bank',
	'undeposited_funds',
	'transfer_clearing',
	'accounts_receivable',
	'prepaid_expense',
	'input_vat',
	// Liabilities
	'accounts_payable',
	'output_vat_payable',
	'withholding_tax_payable',
	'sss_payable',
	'philhealth_payable',
	'pagibig_payable',
	'guest_deposits_held',
	// Equity
	'owners_equity',
	'owners_draw',
	'retained_earnings',
	// Income
	'room_revenue',
	'hall_revenue',
	'other_operating_revenue',
	// Expense
	'cogs_expense',
	'utilities_expense',
	'payroll_expense',
	'supplies_expense',
	'repairs_expense',
	'marketing_expense',
	'commissions_expense',
	'taxes_licenses_expense',
	'rent_expense',
	'admin_expense',
	'statutory_remittance_expense',
	'cash_over_short',
	'other_expense'
]);
export type AccountSubtype = z.infer<typeof accountSubtype>;
