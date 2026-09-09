import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index';
import {
	cashAccounts,
	cashMovements,
	expenseCategories,
	expenses,
	recurringExpenses,
	vendors,
	type CashAccount,
	type ExpenseCategory,
	type Vendor
} from '../db/schema/index';
import { writeAudit } from '../audit';
import type { SessionUser } from '../auth/session';
import { FinanceError } from './shared';

// --- Cash accounts ---------------------------------------------------------

export async function listCashAccounts(hotelId: string, opts: { includeInactive?: boolean } = {}) {
	const conds = [eq(cashAccounts.hotelId, hotelId), sql`${cashAccounts.deletedAt} is null`];
	if (!opts.includeInactive) conds.push(eq(cashAccounts.isActive, true));
	return db
		.select()
		.from(cashAccounts)
		.where(and(...conds))
		.orderBy(asc(cashAccounts.sortOrder), asc(cashAccounts.name));
}

export async function createCashAccount(
	hotelId: string,
	input: {
		name: string;
		kind: CashAccount['kind'];
		institution?: string | null;
		accountRef?: string | null;
		openingBalanceCentavos?: number;
	},
	actor: SessionUser | null
): Promise<string> {
	if (!input.name.trim()) throw new FinanceError('Give the account a name.');
	const opening = input.openingBalanceCentavos ?? 0;
	const [row] = await db
		.insert(cashAccounts)
		.values({
			hotelId,
			name: input.name.trim(),
			kind: input.kind,
			institution: input.institution?.trim() || null,
			accountRef: input.accountRef?.trim() || null,
			openingBalanceCentavos: opening,
			currentBalanceCentavos: opening
		})
		.returning({ id: cashAccounts.id });
	await writeAudit({
		hotelId,
		actor,
		action: 'finance.create_cash_account',
		entityType: 'cash_account',
		entityId: row!.id,
		after: input
	});
	return row!.id;
}

export async function updateCashAccount(
	hotelId: string,
	accountId: string,
	patch: {
		name?: string;
		institution?: string | null;
		accountRef?: string | null;
		isActive?: boolean;
		sortOrder?: number;
	},
	actor: SessionUser | null
): Promise<void> {
	const [a] = await db
		.select()
		.from(cashAccounts)
		.where(and(eq(cashAccounts.id, accountId), eq(cashAccounts.hotelId, hotelId)))
		.limit(1);
	if (!a) throw new FinanceError('Account not found.');
	if (a.isSystem && patch.isActive === false)
		throw new FinanceError("The Undeposited Funds account can't be deactivated.");
	await db
		.update(cashAccounts)
		.set({
			name: patch.name?.trim() ?? a.name,
			institution:
				patch.institution === undefined ? a.institution : patch.institution?.trim() || null,
			accountRef: patch.accountRef === undefined ? a.accountRef : patch.accountRef?.trim() || null,
			isActive: patch.isActive ?? a.isActive,
			sortOrder: patch.sortOrder ?? a.sortOrder,
			updatedAt: new Date()
		})
		.where(eq(cashAccounts.id, accountId));
	await writeAudit({
		hotelId,
		actor,
		action: 'finance.update_cash_account',
		entityType: 'cash_account',
		entityId: accountId,
		after: patch
	});
}

/** Soft-delete only when the account has never been used. */
export async function deleteCashAccount(
	hotelId: string,
	accountId: string,
	actor: SessionUser | null
): Promise<void> {
	const [a] = await db
		.select()
		.from(cashAccounts)
		.where(and(eq(cashAccounts.id, accountId), eq(cashAccounts.hotelId, hotelId)))
		.limit(1);
	if (!a) throw new FinanceError('Account not found.');
	if (a.isSystem) throw new FinanceError("The Undeposited Funds account can't be deleted.");
	const [used] = await db
		.select({ id: cashMovements.id })
		.from(cashMovements)
		.where(eq(cashMovements.cashAccountId, accountId))
		.limit(1);
	if (used)
		throw new FinanceError('This account has movements — deactivate it instead of deleting.');
	await db
		.update(cashAccounts)
		.set({ deletedAt: new Date(), isActive: false })
		.where(eq(cashAccounts.id, accountId));
	await writeAudit({
		hotelId,
		actor,
		action: 'finance.delete_cash_account',
		entityType: 'cash_account',
		entityId: accountId
	});
}

// --- Expense categories ---------------------------------------------------

export async function listExpenseCategories(
	hotelId: string,
	opts: { includeInactive?: boolean } = {}
) {
	const conds = [
		eq(expenseCategories.hotelId, hotelId),
		sql`${expenseCategories.deletedAt} is null`
	];
	if (!opts.includeInactive) conds.push(eq(expenseCategories.isActive, true));
	return db
		.select()
		.from(expenseCategories)
		.where(and(...conds))
		.orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name));
}

export async function createExpenseCategory(
	hotelId: string,
	input: { name: string; group: ExpenseCategory['group'] },
	actor: SessionUser | null
): Promise<string> {
	if (!input.name.trim()) throw new FinanceError('Give the category a name.');
	const [row] = await db
		.insert(expenseCategories)
		.values({ hotelId, name: input.name.trim(), group: input.group })
		.returning({ id: expenseCategories.id });
	await writeAudit({
		hotelId,
		actor,
		action: 'finance.create_expense_category',
		entityType: 'expense_category',
		entityId: row!.id,
		after: input
	});
	return row!.id;
}

export async function updateExpenseCategory(
	hotelId: string,
	categoryId: string,
	patch: {
		name?: string;
		group?: ExpenseCategory['group'];
		isActive?: boolean;
		sortOrder?: number;
	},
	actor: SessionUser | null
): Promise<void> {
	const [c] = await db
		.select()
		.from(expenseCategories)
		.where(and(eq(expenseCategories.id, categoryId), eq(expenseCategories.hotelId, hotelId)))
		.limit(1);
	if (!c) throw new FinanceError('Category not found.');
	await db
		.update(expenseCategories)
		.set({
			name: patch.name?.trim() ?? c.name,
			group: patch.group ?? c.group,
			isActive: patch.isActive ?? c.isActive,
			sortOrder: patch.sortOrder ?? c.sortOrder,
			updatedAt: new Date()
		})
		.where(eq(expenseCategories.id, categoryId));
	await writeAudit({
		hotelId,
		actor,
		action: 'finance.update_expense_category',
		entityType: 'expense_category',
		entityId: categoryId,
		after: patch
	});
}

export async function deleteExpenseCategory(
	hotelId: string,
	categoryId: string,
	actor: SessionUser | null
): Promise<void> {
	const [used] = await db
		.select({ id: expenses.id })
		.from(expenses)
		.where(eq(expenses.categoryId, categoryId))
		.limit(1);
	const [usedR] = await db
		.select({ id: recurringExpenses.id })
		.from(recurringExpenses)
		.where(eq(recurringExpenses.categoryId, categoryId))
		.limit(1);
	if (used || usedR)
		throw new FinanceError('This category is in use — deactivate it instead of deleting.');
	await db
		.update(expenseCategories)
		.set({ deletedAt: new Date(), isActive: false })
		.where(and(eq(expenseCategories.id, categoryId), eq(expenseCategories.hotelId, hotelId)));
	await writeAudit({
		hotelId,
		actor,
		action: 'finance.delete_expense_category',
		entityType: 'expense_category',
		entityId: categoryId
	});
}

// --- Vendors ------------------------------------------------------------

export async function listVendors(hotelId: string, opts: { includeInactive?: boolean } = {}) {
	const conds = [eq(vendors.hotelId, hotelId), sql`${vendors.deletedAt} is null`];
	if (!opts.includeInactive) conds.push(eq(vendors.isActive, true));
	return db
		.select()
		.from(vendors)
		.where(and(...conds))
		.orderBy(asc(vendors.name));
}

type VendorInput = {
	name: string;
	tin?: string | null;
	address?: string | null;
	contactName?: string | null;
	contactPhone?: string | null;
	contactEmail?: string | null;
	isActive?: boolean;
};

export async function createVendor(
	hotelId: string,
	input: VendorInput,
	actor: SessionUser | null
): Promise<string> {
	if (!input.name.trim()) throw new FinanceError('Give the vendor a name.');
	const [row] = await db
		.insert(vendors)
		.values({
			hotelId,
			name: input.name.trim(),
			tin: input.tin?.trim() || null,
			address: input.address?.trim() || null,
			contactName: input.contactName?.trim() || null,
			contactPhone: input.contactPhone?.trim() || null,
			contactEmail: input.contactEmail?.trim() || null
		})
		.returning({ id: vendors.id });
	await writeAudit({
		hotelId,
		actor,
		action: 'finance.create_vendor',
		entityType: 'vendor',
		entityId: row!.id,
		after: { name: input.name }
	});
	return row!.id;
}

export async function updateVendor(
	hotelId: string,
	vendorId: string,
	patch: Partial<VendorInput>,
	actor: SessionUser | null
): Promise<void> {
	const [v] = await db
		.select()
		.from(vendors)
		.where(and(eq(vendors.id, vendorId), eq(vendors.hotelId, hotelId)))
		.limit(1);
	if (!v) throw new FinanceError('Vendor not found.');
	await db
		.update(vendors)
		.set({
			name: patch.name?.trim() ?? v.name,
			tin: patch.tin === undefined ? v.tin : patch.tin?.trim() || null,
			address: patch.address === undefined ? v.address : patch.address?.trim() || null,
			contactName:
				patch.contactName === undefined ? v.contactName : patch.contactName?.trim() || null,
			contactPhone:
				patch.contactPhone === undefined ? v.contactPhone : patch.contactPhone?.trim() || null,
			contactEmail:
				patch.contactEmail === undefined ? v.contactEmail : patch.contactEmail?.trim() || null,
			isActive: patch.isActive ?? v.isActive,
			updatedAt: new Date()
		})
		.where(eq(vendors.id, vendorId));
	await writeAudit({
		hotelId,
		actor,
		action: 'finance.update_vendor',
		entityType: 'vendor',
		entityId: vendorId,
		after: patch
	});
}

export async function deleteVendor(
	hotelId: string,
	vendorId: string,
	actor: SessionUser | null
): Promise<void> {
	const [used] = await db
		.select({ id: expenses.id })
		.from(expenses)
		.where(eq(expenses.vendorId, vendorId))
		.limit(1);
	if (used) throw new FinanceError('This vendor has expenses — deactivate it instead of deleting.');
	await db
		.update(vendors)
		.set({ deletedAt: new Date(), isActive: false })
		.where(and(eq(vendors.id, vendorId), eq(vendors.hotelId, hotelId)));
	await writeAudit({
		hotelId,
		actor,
		action: 'finance.delete_vendor',
		entityType: 'vendor',
		entityId: vendorId
	});
}

// --- Recurring expense templates ---------------------------------------

export async function listRecurringExpenses(hotelId: string) {
	return db
		.select({
			id: recurringExpenses.id,
			description: recurringExpenses.description,
			amountCentavos: recurringExpenses.amountCentavos,
			isVatable: recurringExpenses.isVatable,
			cadence: recurringExpenses.cadence,
			anchorDay: recurringExpenses.anchorDay,
			nextDueOn: recurringExpenses.nextDueOn,
			isActive: recurringExpenses.isActive,
			categoryId: recurringExpenses.categoryId,
			categoryName: expenseCategories.name,
			vendorId: recurringExpenses.vendorId,
			vendorName: vendors.name
		})
		.from(recurringExpenses)
		.innerJoin(expenseCategories, eq(expenseCategories.id, recurringExpenses.categoryId))
		.leftJoin(vendors, eq(vendors.id, recurringExpenses.vendorId))
		.where(and(eq(recurringExpenses.hotelId, hotelId), sql`${recurringExpenses.deletedAt} is null`))
		.orderBy(asc(recurringExpenses.nextDueOn));
}

export async function createRecurringExpense(
	hotelId: string,
	input: {
		categoryId: string;
		vendorId?: string | null;
		description: string;
		amountCentavos: number;
		isVatable: boolean;
		cadence: 'weekly' | 'monthly' | 'quarterly' | 'annually';
		anchorDay: number;
		nextDueOn: string;
	},
	actor: SessionUser | null
): Promise<string> {
	if (!input.description.trim()) throw new FinanceError('Describe the recurring expense.');
	if (!Number.isInteger(input.amountCentavos) || input.amountCentavos <= 0)
		throw new FinanceError('Enter an amount.');
	const [row] = await db
		.insert(recurringExpenses)
		.values({
			hotelId,
			categoryId: input.categoryId,
			vendorId: input.vendorId ?? null,
			description: input.description.trim(),
			amountCentavos: input.amountCentavos,
			isVatable: input.isVatable,
			cadence: input.cadence,
			anchorDay: input.anchorDay,
			nextDueOn: input.nextDueOn,
			createdByUserId: actor?.id ?? null
		})
		.returning({ id: recurringExpenses.id });
	await writeAudit({
		hotelId,
		actor,
		action: 'finance.create_recurring_expense',
		entityType: 'recurring_expense',
		entityId: row!.id,
		after: input
	});
	return row!.id;
}

export async function setRecurringExpenseActive(
	hotelId: string,
	id: string,
	isActive: boolean,
	actor: SessionUser | null
): Promise<void> {
	await db
		.update(recurringExpenses)
		.set({ isActive, updatedAt: new Date() })
		.where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.hotelId, hotelId)));
	await writeAudit({
		hotelId,
		actor,
		action: 'finance.toggle_recurring_expense',
		entityType: 'recurring_expense',
		entityId: id,
		after: { isActive }
	});
}
