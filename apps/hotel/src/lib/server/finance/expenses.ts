import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/index';
import {
	cashAccounts,
	cashMovements,
	expenseCategories,
	expenses,
	hotels,
	recurringExpenses,
	vendors,
	type Expense,
	type NewExpense
} from '../db/schema/index';
import { writeAudit } from '../audit';
import type { SessionUser } from '../auth/session';
import { FinanceError, businessDateFor, type Tx } from './shared';
import { advanceDueDate, inputVatOf } from './calc';
import { recordCashMovement } from './cash';
import { getFinanceSettings } from './settings';

export { advanceDueDate, inputVatOf } from './calc';

type PaymentMethod = NonNullable<Expense['paymentMethod']>;

async function hotelVatRate(hotelId: string): Promise<number> {
	const [h] = await db
		.select({ bps: hotels.vatRateBps })
		.from(hotels)
		.where(eq(hotels.id, hotelId))
		.limit(1);
	return h?.bps ?? 1200;
}

export interface CreateExpenseInput {
	hotelId: string;
	expenseDate: string;
	categoryId: string;
	vendorId?: string | null;
	description: string;
	vendorInvoiceNo?: string | null;
	grossCentavos: number;
	isVatable: boolean;
	/** Override the auto-computed input VAT; omit to use `inputVatOf`. */
	inputVatCentavos?: number | null;
	withholdingTaxCentavos?: number;
	notes?: string | null;
	attachmentUrl?: string | null;
	actor: SessionUser | null;
}

export async function createExpense(
	input: CreateExpenseInput
): Promise<{ expenseId: string; status: Expense['status'] }> {
	if (!Number.isInteger(input.grossCentavos) || input.grossCentavos <= 0) {
		throw new FinanceError('Enter an expense amount greater than zero.');
	}
	if (!input.description.trim()) throw new FinanceError('Give the expense a description.');

	const [cat] = await db
		.select({ id: expenseCategories.id })
		.from(expenseCategories)
		.where(
			and(eq(expenseCategories.id, input.categoryId), eq(expenseCategories.hotelId, input.hotelId))
		)
		.limit(1);
	if (!cat) throw new FinanceError('Pick a valid expense category.');

	const vatRate = await hotelVatRate(input.hotelId);
	const inputVat = input.isVatable
		? Math.min(
				input.grossCentavos,
				input.inputVatCentavos ?? inputVatOf(input.grossCentavos, vatRate)
			)
		: 0;
	const settings = await getFinanceSettings(input.hotelId);
	const status: Expense['status'] = settings.requireExpenseApproval ? 'draft' : 'approved';

	const values: NewExpense = {
		hotelId: input.hotelId,
		expenseDate: input.expenseDate,
		categoryId: input.categoryId,
		vendorId: input.vendorId ?? null,
		description: input.description.trim(),
		vendorInvoiceNo: input.vendorInvoiceNo?.trim() || null,
		grossCentavos: input.grossCentavos,
		inputVatCentavos: inputVat,
		netOfVatCentavos: input.grossCentavos - inputVat,
		isVatable: input.isVatable,
		withholdingTaxCentavos: input.withholdingTaxCentavos ?? 0,
		status,
		notes: input.notes?.trim() || null,
		attachmentUrl: input.attachmentUrl ?? null,
		createdByUserId: input.actor?.id ?? null,
		approvedByUserId: status === 'approved' ? (input.actor?.id ?? null) : null,
		approvedAt: status === 'approved' ? new Date() : null
	};

	const [row] = await db.insert(expenses).values(values).returning({ id: expenses.id });
	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'finance.create_expense',
		entityType: 'expense',
		entityId: row!.id,
		after: { grossCentavos: input.grossCentavos, status }
	});
	return { expenseId: row!.id, status };
}

export async function updateExpense(
	hotelId: string,
	expenseId: string,
	patch: Partial<CreateExpenseInput>,
	actor: SessionUser | null
): Promise<void> {
	const [e] = await db
		.select()
		.from(expenses)
		.where(and(eq(expenses.id, expenseId), eq(expenses.hotelId, hotelId)))
		.limit(1);
	if (!e) throw new FinanceError('Expense not found.');
	if (e.status === 'paid' || e.status === 'void')
		throw new FinanceError("A paid or voided expense can't be edited.");

	const gross = patch.grossCentavos ?? e.grossCentavos;
	const isVatable = patch.isVatable ?? e.isVatable;
	const vatRate = await hotelVatRate(hotelId);
	const inputVat = isVatable
		? Math.min(gross, patch.inputVatCentavos ?? inputVatOf(gross, vatRate))
		: 0;

	await db
		.update(expenses)
		.set({
			expenseDate: patch.expenseDate ?? e.expenseDate,
			categoryId: patch.categoryId ?? e.categoryId,
			vendorId: patch.vendorId === undefined ? e.vendorId : patch.vendorId,
			description: patch.description?.trim() ?? e.description,
			vendorInvoiceNo:
				patch.vendorInvoiceNo === undefined
					? e.vendorInvoiceNo
					: patch.vendorInvoiceNo?.trim() || null,
			grossCentavos: gross,
			isVatable,
			inputVatCentavos: inputVat,
			netOfVatCentavos: gross - inputVat,
			withholdingTaxCentavos: patch.withholdingTaxCentavos ?? e.withholdingTaxCentavos,
			notes: patch.notes === undefined ? e.notes : patch.notes?.trim() || null,
			attachmentUrl: patch.attachmentUrl === undefined ? e.attachmentUrl : patch.attachmentUrl,
			updatedAt: new Date()
		})
		.where(eq(expenses.id, expenseId));

	await writeAudit({
		hotelId,
		actor,
		action: 'finance.update_expense',
		entityType: 'expense',
		entityId: expenseId,
		after: patch
	});
}

export async function approveExpense(
	hotelId: string,
	expenseId: string,
	actor: SessionUser | null
): Promise<void> {
	const [e] = await db
		.select()
		.from(expenses)
		.where(and(eq(expenses.id, expenseId), eq(expenses.hotelId, hotelId)))
		.limit(1);
	if (!e) throw new FinanceError('Expense not found.');
	if (e.status !== 'draft') throw new FinanceError('Only a draft expense can be approved.');
	await db
		.update(expenses)
		.set({
			status: 'approved',
			approvedByUserId: actor?.id ?? null,
			approvedAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(expenses.id, expenseId));
	await writeAudit({
		hotelId,
		actor,
		action: 'finance.approve_expense',
		entityType: 'expense',
		entityId: expenseId
	});
}

export async function markExpensePaid(input: {
	hotelId: string;
	expenseId: string;
	paidFromAccountId: string;
	paymentMethod: PaymentMethod;
	paymentReferenceNo?: string | null;
	paidOn?: string | null;
	actor: SessionUser | null;
}): Promise<void> {
	const [e] = await db
		.select()
		.from(expenses)
		.where(and(eq(expenses.id, input.expenseId), eq(expenses.hotelId, input.hotelId)))
		.limit(1);
	if (!e) throw new FinanceError('Expense not found.');
	if (e.status === 'paid') throw new FinanceError('That expense is already paid.');
	if (e.status === 'void') throw new FinanceError('That expense is voided.');

	const [account] = await db
		.select()
		.from(cashAccounts)
		.where(
			and(eq(cashAccounts.id, input.paidFromAccountId), eq(cashAccounts.hotelId, input.hotelId))
		)
		.limit(1);
	if (!account || !account.isActive) throw new FinanceError('Pick a valid account to pay from.');
	if (account.currentBalanceCentavos < e.grossCentavos) {
		throw new FinanceError(`${account.name} doesn't hold enough to cover this expense.`);
	}

	const [hotel] = await db
		.select({ timezone: hotels.timezone })
		.from(hotels)
		.where(eq(hotels.id, input.hotelId))
		.limit(1);
	const businessDate = businessDateFor(hotel?.timezone ?? 'Asia/Manila');
	const [cat] = await db
		.select({ group: expenseCategories.group, name: expenseCategories.name })
		.from(expenseCategories)
		.where(eq(expenseCategories.id, e.categoryId))
		.limit(1);
	const category =
		cat?.group === 'payroll'
			? 'payroll'
			: cat?.group === 'taxes_licenses'
				? 'statutory_remittance'
				: 'expense';
	const [vendor] = e.vendorId
		? await db
				.select({ name: vendors.name })
				.from(vendors)
				.where(eq(vendors.id, e.vendorId))
				.limit(1)
		: [undefined];

	await db.transaction(async (tx: Tx) => {
		await recordCashMovement(
			{
				hotelId: input.hotelId,
				businessDate,
				direction: 'out',
				category,
				cashAccountId: input.paidFromAccountId,
				amountCentavos: e.grossCentavos,
				counterpartyType: 'vendor',
				counterpartyName: vendor?.name ?? null,
				counterpartyId: e.vendorId ?? null,
				sourceType: 'expense',
				sourceId: e.id,
				memo: `${cat?.name ?? 'Expense'} — ${e.description}`,
				actor: input.actor
			},
			tx
		);
		await tx
			.update(expenses)
			.set({
				status: 'paid',
				paidFromAccountId: input.paidFromAccountId,
				paymentMethod: input.paymentMethod,
				paymentReferenceNo: input.paymentReferenceNo?.trim() || null,
				paidAt: input.paidOn ? new Date(`${input.paidOn}T00:00:00`) : new Date(),
				approvedByUserId: e.approvedByUserId ?? input.actor?.id ?? null,
				approvedAt: e.approvedAt ?? new Date(),
				updatedAt: new Date()
			})
			.where(eq(expenses.id, e.id));
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'finance.pay_expense',
		entityType: 'expense',
		entityId: e.id,
		after: { paidFromAccountId: input.paidFromAccountId, amountCentavos: e.grossCentavos }
	});
}

export async function voidExpense(
	hotelId: string,
	expenseId: string,
	reason: string,
	actor: SessionUser | null
): Promise<void> {
	if (!reason.trim()) throw new FinanceError('A void needs a reason.');
	await db.transaction(async (tx: Tx) => {
		const [e] = await tx
			.select()
			.from(expenses)
			.where(and(eq(expenses.id, expenseId), eq(expenses.hotelId, hotelId)))
			.limit(1);
		if (!e) throw new FinanceError('Expense not found.');
		if (e.status === 'void') throw new FinanceError('Already voided.');

		if (e.status === 'paid') {
			const movements = await tx
				.select()
				.from(cashMovements)
				.where(
					and(
						eq(cashMovements.sourceType, 'expense'),
						eq(cashMovements.sourceId, expenseId),
						sql`${cashMovements.voidedAt} is null`
					)
				);
			for (const m of movements) {
				const reverse = m.direction === 'in' ? -m.amountCentavos : m.amountCentavos;
				await tx
					.update(cashAccounts)
					.set({
						currentBalanceCentavos: sql`${cashAccounts.currentBalanceCentavos} + ${reverse}`,
						updatedAt: new Date()
					})
					.where(eq(cashAccounts.id, m.cashAccountId));
				await tx
					.update(cashMovements)
					.set({
						voidedAt: new Date(),
						voidedByUserId: actor?.id ?? null,
						voidReason: 'Expense voided'
					})
					.where(eq(cashMovements.id, m.id));
			}
		}

		await tx
			.update(expenses)
			.set({
				status: 'void',
				notes: sql`coalesce(${expenses.notes} || E'\n', '') || ${'Voided: ' + reason.trim()}`,
				updatedAt: new Date()
			})
			.where(eq(expenses.id, expenseId));
	});
	await writeAudit({
		hotelId,
		actor,
		action: 'finance.void_expense',
		entityType: 'expense',
		entityId: expenseId,
		after: { reason }
	});
}

export interface ExpenseFilters {
	from?: string;
	to?: string;
	status?: Expense['status'];
	categoryId?: string;
	vendorId?: string;
	limit?: number;
}

export async function listExpenses(hotelId: string, filters: ExpenseFilters = {}) {
	const conds = [eq(expenses.hotelId, hotelId), sql`${expenses.deletedAt} is null`];
	if (filters.from) conds.push(gte(expenses.expenseDate, filters.from));
	if (filters.to) conds.push(lte(expenses.expenseDate, filters.to));
	if (filters.status) conds.push(eq(expenses.status, filters.status));
	if (filters.categoryId) conds.push(eq(expenses.categoryId, filters.categoryId));
	if (filters.vendorId) conds.push(eq(expenses.vendorId, filters.vendorId));

	return db
		.select({
			id: expenses.id,
			expenseDate: expenses.expenseDate,
			description: expenses.description,
			categoryName: expenseCategories.name,
			categoryGroup: expenseCategories.group,
			vendorName: vendors.name,
			grossCentavos: expenses.grossCentavos,
			inputVatCentavos: expenses.inputVatCentavos,
			netOfVatCentavos: expenses.netOfVatCentavos,
			withholdingTaxCentavos: expenses.withholdingTaxCentavos,
			status: expenses.status,
			paidAt: expenses.paidAt,
			attachmentUrl: expenses.attachmentUrl,
			vendorInvoiceNo: expenses.vendorInvoiceNo
		})
		.from(expenses)
		.innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
		.leftJoin(vendors, eq(vendors.id, expenses.vendorId))
		.where(and(...conds))
		.orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
		.limit(filters.limit ?? 500);
}

/** Creates a draft expense for every active recurring template due on/before `asOf`,
 *  then advances each template. Manual for now (a button in the UI); a cron can call
 *  this later. */
export async function generateDueRecurringExpenses(
	hotelId: string,
	asOf: string,
	actor: SessionUser | null
): Promise<{ created: number }> {
	const due = await db
		.select()
		.from(recurringExpenses)
		.where(
			and(
				eq(recurringExpenses.hotelId, hotelId),
				eq(recurringExpenses.isActive, true),
				lte(recurringExpenses.nextDueOn, asOf),
				sql`${recurringExpenses.deletedAt} is null`
			)
		)
		.orderBy(asc(recurringExpenses.nextDueOn));

	const vatRate = await hotelVatRate(hotelId);
	let created = 0;
	for (const t of due) {
		const inputVat = t.isVatable ? inputVatOf(t.amountCentavos, vatRate) : 0;
		await db.transaction(async (tx: Tx) => {
			await tx.insert(expenses).values({
				hotelId,
				expenseDate: t.nextDueOn,
				categoryId: t.categoryId,
				vendorId: t.vendorId,
				description: t.description,
				grossCentavos: t.amountCentavos,
				inputVatCentavos: inputVat,
				netOfVatCentavos: t.amountCentavos - inputVat,
				isVatable: t.isVatable,
				status: 'draft',
				recurringExpenseId: t.id,
				createdByUserId: actor?.id ?? null
			});
			await tx
				.update(recurringExpenses)
				.set({
					nextDueOn: advanceDueDate(t.nextDueOn, t.cadence, t.anchorDay),
					updatedAt: new Date()
				})
				.where(eq(recurringExpenses.id, t.id));
		});
		created += 1;
	}

	if (created > 0) {
		await writeAudit({
			hotelId,
			actor,
			action: 'finance.generate_recurring_expenses',
			entityType: 'hotel',
			entityId: hotelId,
			after: { created, asOf }
		});
	}
	return { created };
}
