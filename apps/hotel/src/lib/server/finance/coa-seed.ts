import type { AccountSubtype } from '@mm/finance-core';
import type { CashMovement, ExpenseCategory } from '../db/schema/index';

type CashCategory = CashMovement['category'];
type ExpenseGroup = ExpenseCategory['group'];

export interface CoaSeedAccount {
	code: string;
	name: string;
	type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
	subtype: AccountSubtype;
	normalBalance: 'debit' | 'credit';
	/** Seeded accounts staff can't rename/delete — mirrors `cash_accounts.isSystem`. */
	isSystem?: boolean;
}

/**
 * The default per-hotel chart of accounts, inserted once by
 * `finance/seed-defaults.ts`'s `seedFinanceDefaults`. Flat (no parent/child roll-up)
 * for v1 — every account is directly postable.
 */
export const COA_SEED: CoaSeedAccount[] = [
	// Assets
	{ code: '1010', name: 'Front Desk Drawer', type: 'asset', subtype: 'cash_on_hand', normalBalance: 'debit' },
	{ code: '1011', name: 'Petty Cash', type: 'asset', subtype: 'cash_on_hand', normalBalance: 'debit' },
	{ code: '1020', name: 'Bank — Main', type: 'asset', subtype: 'cash_in_bank', normalBalance: 'debit' },
	{ code: '1030', name: 'E-wallet', type: 'asset', subtype: 'cash_in_bank', normalBalance: 'debit' },
	{ code: '1090', name: 'Undeposited Funds', type: 'asset', subtype: 'undeposited_funds', normalBalance: 'debit' },
	{
		code: '1091',
		name: 'Interbank Transfer Clearing',
		type: 'asset',
		subtype: 'transfer_clearing',
		normalBalance: 'debit',
		isSystem: true
	},
	{ code: '1200', name: 'Accounts Receivable', type: 'asset', subtype: 'accounts_receivable', normalBalance: 'debit' },

	// Liabilities
	{ code: '2010', name: 'Accounts Payable', type: 'liability', subtype: 'accounts_payable', normalBalance: 'credit' },
	{ code: '2020', name: 'Output VAT Payable', type: 'liability', subtype: 'output_vat_payable', normalBalance: 'credit' },
	{
		code: '2030',
		name: 'Withholding Tax Payable',
		type: 'liability',
		subtype: 'withholding_tax_payable',
		normalBalance: 'credit'
	},
	{ code: '2040', name: 'Guest Deposits Held', type: 'liability', subtype: 'guest_deposits_held', normalBalance: 'credit' },

	// Equity
	{ code: '3010', name: "Owner's Equity", type: 'equity', subtype: 'owners_equity', normalBalance: 'credit' },
	{ code: '3020', name: "Owner's Draw", type: 'equity', subtype: 'owners_draw', normalBalance: 'debit' },
	{ code: '3030', name: 'Retained Earnings', type: 'equity', subtype: 'retained_earnings', normalBalance: 'credit' },

	// Income
	{ code: '4010', name: 'Room Revenue', type: 'income', subtype: 'room_revenue', normalBalance: 'credit' },
	{ code: '4020', name: 'Function Hall Revenue', type: 'income', subtype: 'hall_revenue', normalBalance: 'credit' },
	{
		code: '4030',
		name: 'Other Operating Revenue',
		type: 'income',
		subtype: 'other_operating_revenue',
		normalBalance: 'credit'
	},
	{
		code: '4090',
		name: 'Refunds & Allowances',
		type: 'income',
		subtype: 'other_operating_revenue',
		normalBalance: 'debit'
	},

	// Expenses
	{ code: '5010', name: 'Cost of Goods Sold', type: 'expense', subtype: 'cogs_expense', normalBalance: 'debit' },
	{ code: '5020', name: 'Utilities Expense', type: 'expense', subtype: 'utilities_expense', normalBalance: 'debit' },
	{ code: '5030', name: 'Payroll Expense', type: 'expense', subtype: 'payroll_expense', normalBalance: 'debit' },
	{ code: '5040', name: 'Supplies Expense', type: 'expense', subtype: 'supplies_expense', normalBalance: 'debit' },
	{
		code: '5050',
		name: 'Repairs & Maintenance Expense',
		type: 'expense',
		subtype: 'repairs_expense',
		normalBalance: 'debit'
	},
	{ code: '5060', name: 'Marketing Expense', type: 'expense', subtype: 'marketing_expense', normalBalance: 'debit' },
	{ code: '5070', name: 'Commissions Expense', type: 'expense', subtype: 'commissions_expense', normalBalance: 'debit' },
	{
		code: '5080',
		name: 'Taxes & Licenses Expense',
		type: 'expense',
		subtype: 'taxes_licenses_expense',
		normalBalance: 'debit'
	},
	{ code: '5090', name: 'Rent Expense', type: 'expense', subtype: 'rent_expense', normalBalance: 'debit' },
	{ code: '5100', name: 'Admin Expense', type: 'expense', subtype: 'admin_expense', normalBalance: 'debit' },
	{
		code: '5110',
		name: 'Statutory Remittances Expense',
		type: 'expense',
		subtype: 'statutory_remittance_expense',
		normalBalance: 'debit'
	},
	{ code: '5900', name: 'Other Expense', type: 'expense', subtype: 'other_expense', normalBalance: 'debit' },
	{ code: '5990', name: 'Cash Over/Short', type: 'expense', subtype: 'cash_over_short', normalBalance: 'debit' }
];

/** `cash_accounts.kind` -> seeded COA `code`. */
export const CASH_ACCOUNT_KIND_TO_COA_CODE: Record<string, string> = {
	cash_drawer: '1010',
	petty_cash: '1011',
	bank: '1020',
	e_wallet: '1030',
	undeposited: '1090'
};

/** `cash_movements.category` -> seeded COA `code`. `transfer_in`/`transfer_out`/
 *  `bank_deposit` all point at the clearing account (1091) — see
 *  `finance/cash.ts`'s auto-posting for why each movement must balance on its own. */
export const CASH_CATEGORY_TO_COA_CODE: Record<CashCategory, string> = {
	room_revenue: '4010',
	hall_revenue: '4020',
	incidental_sale: '4030',
	deposit: '2040',
	deposit_refund: '2040',
	refund: '4090',
	other_revenue: '4030',
	expense: '5900',
	payroll: '5030',
	statutory_remittance: '5110',
	bank_deposit: '1091',
	transfer_in: '1091',
	transfer_out: '1091',
	owner_contribution: '3010',
	owner_draw: '3020',
	adjustment: '5990'
};

/** `expense_categories.group` -> seeded COA `code`, for the specific expense-account
 *  override (`finance/expenses.ts` passes this as `coaAccountId`). */
export const EXPENSE_GROUP_TO_COA_CODE: Record<ExpenseGroup, string> = {
	cogs: '5010',
	utilities: '5020',
	payroll: '5030',
	supplies: '5040',
	repairs: '5050',
	marketing: '5060',
	commissions: '5070',
	taxes_licenses: '5080',
	rent: '5090',
	admin: '5100',
	other: '5900'
};
