import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/index';
import {
	cashAccounts,
	cashMovements,
	dayCloses,
	financeSettings,
	type CashMovement
} from '../db/schema/index';
import { writeAudit } from '../audit';
import type { SessionUser } from '../auth/session';
import { FinanceError, pesos, type Tx } from './shared';

type CashDirection = 'in' | 'out';
type CashCategory = CashMovement['category'];
type CounterpartyType = NonNullable<CashMovement['counterpartyType']>;

export interface RecordMovementInput {
	hotelId: string;
	businessDate: string;
	occurredAt?: Date;
	direction: CashDirection;
	category: CashCategory;
	cashAccountId: string;
	amountCentavos: number;
	counterpartyType?: CounterpartyType | null;
	counterpartyName?: string | null;
	counterpartyId?: string | null;
	sourceType?: string;
	sourceId?: string | null;
	paymentId?: string | null;
	shiftId?: string | null;
	transferGroupId?: string | null;
	memo?: string | null;
	actor?: SessionUser | null;
}

/**
 * THE single choke point for money moving in or out of any `cash_accounts` row.
 * Inserts the movement **and** adjusts the account's denormalized
 * `currentBalanceCentavos` in the same statement/transaction. Never insert a
 * `cash_movements` row or touch `currentBalanceCentavos` any other way.
 *
 * Pass a `tx` when the movement must be atomic with a larger operation (a payment,
 * an expense payout); omit it and this opens its own transaction.
 */
export async function recordCashMovement(input: RecordMovementInput, tx?: Tx): Promise<string> {
	if (!Number.isInteger(input.amountCentavos) || input.amountCentavos <= 0) {
		throw new FinanceError('A cash movement amount must be a positive whole number of centavos.');
	}
	const run = async (t: Tx) => {
		await assertBusinessDateOpen(input.hotelId, input.businessDate, t);

		const [account] = await t
			.select({ id: cashAccounts.id, hotelId: cashAccounts.hotelId })
			.from(cashAccounts)
			.where(eq(cashAccounts.id, input.cashAccountId))
			.limit(1);
		if (!account || account.hotelId !== input.hotelId)
			throw new FinanceError('Cash account not found.');

		const [row] = await t
			.insert(cashMovements)
			.values({
				hotelId: input.hotelId,
				businessDate: input.businessDate,
				occurredAt: input.occurredAt ?? new Date(),
				direction: input.direction,
				category: input.category,
				cashAccountId: input.cashAccountId,
				amountCentavos: input.amountCentavos,
				counterpartyType: input.counterpartyType ?? null,
				counterpartyName: input.counterpartyName ?? null,
				counterpartyId: input.counterpartyId ?? null,
				sourceType: input.sourceType ?? 'manual',
				sourceId: input.sourceId ?? null,
				paymentId: input.paymentId ?? null,
				shiftId: input.shiftId ?? null,
				transferGroupId: input.transferGroupId ?? null,
				memo: input.memo ?? null,
				recordedByUserId: input.actor?.id ?? null
			})
			.returning({ id: cashMovements.id });

		const delta = input.direction === 'in' ? input.amountCentavos : -input.amountCentavos;
		await t
			.update(cashAccounts)
			.set({
				currentBalanceCentavos: sql`${cashAccounts.currentBalanceCentavos} + ${delta}`,
				updatedAt: new Date()
			})
			.where(eq(cashAccounts.id, input.cashAccountId));

		return row!.id;
	};

	return tx ? run(tx) : db.transaction(run);
}

/** Soft-void a movement and reverse its effect on the account balance. Refuses if the
 *  movement's `businessDate` sits inside a locked day-close (reopen it first). */
export async function voidCashMovement(
	hotelId: string,
	movementId: string,
	reason: string | null,
	actor: SessionUser | null
): Promise<void> {
	await db.transaction(async (tx) => {
		const [m] = await tx
			.select()
			.from(cashMovements)
			.where(and(eq(cashMovements.id, movementId), eq(cashMovements.hotelId, hotelId)))
			.limit(1);
		if (!m) throw new FinanceError('Cash movement not found.');
		if (m.voidedAt) throw new FinanceError('That movement is already voided.');
		await assertBusinessDateOpen(hotelId, m.businessDate, tx);

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
				voidReason: reason?.trim() || null
			})
			.where(eq(cashMovements.id, movementId));
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'finance.void_cash_movement',
		entityType: 'cash_movement',
		entityId: movementId,
		after: { reason: reason || null }
	});
}

export interface TransferInput {
	hotelId: string;
	businessDate: string;
	fromAccountId: string;
	toAccountId: string;
	amountCentavos: number;
	/** `bank_deposit` when moving drawer/petty cash into a bank; otherwise a plain internal transfer. */
	isBankDeposit?: boolean;
	memo?: string | null;
	actor?: SessionUser | null;
}

/** Moves cash between two of the hotel's own accounts as a paired out/in sharing a
 *  `transferGroupId` — used by "Bank deposit", petty-cash top-ups, and shift drops. */
export async function transferBetweenAccounts(
	input: TransferInput
): Promise<{ transferGroupId: string }> {
	if (input.fromAccountId === input.toAccountId)
		throw new FinanceError('Pick two different accounts.');
	if (!Number.isInteger(input.amountCentavos) || input.amountCentavos <= 0) {
		throw new FinanceError('Enter a positive amount to transfer.');
	}
	const transferGroupId = randomUUID();

	await db.transaction(async (tx) => {
		const accounts = await tx
			.select({
				id: cashAccounts.id,
				name: cashAccounts.name,
				balance: cashAccounts.currentBalanceCentavos
			})
			.from(cashAccounts)
			.where(and(eq(cashAccounts.hotelId, input.hotelId), eq(cashAccounts.isActive, true)));
		const from = accounts.find((a) => a.id === input.fromAccountId);
		const to = accounts.find((a) => a.id === input.toAccountId);
		if (!from || !to) throw new FinanceError('One of the accounts was not found.');
		if (from.balance < input.amountCentavos) {
			throw new FinanceError(
				`${from.name} only holds ${pesos(from.balance)} — not enough to transfer ${pesos(input.amountCentavos)}.`
			);
		}

		const memo =
			input.memo?.trim() ||
			(input.isBankDeposit ? `Bank deposit to ${to.name}` : `Transfer to ${to.name}`);
		await recordCashMovement(
			{
				hotelId: input.hotelId,
				businessDate: input.businessDate,
				direction: 'out',
				category: input.isBankDeposit ? 'bank_deposit' : 'transfer_out',
				cashAccountId: input.fromAccountId,
				amountCentavos: input.amountCentavos,
				sourceType: 'transfer',
				transferGroupId,
				memo,
				actor: input.actor
			},
			tx
		);
		await recordCashMovement(
			{
				hotelId: input.hotelId,
				businessDate: input.businessDate,
				direction: 'in',
				category: input.isBankDeposit ? 'bank_deposit' : 'transfer_in',
				cashAccountId: input.toAccountId,
				amountCentavos: input.amountCentavos,
				sourceType: 'transfer',
				transferGroupId,
				memo:
					input.memo?.trim() ||
					(input.isBankDeposit ? `Bank deposit from ${from.name}` : `Transfer from ${from.name}`),
				actor: input.actor
			},
			tx
		);
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: input.isBankDeposit ? 'finance.bank_deposit' : 'finance.transfer',
		entityType: 'cash_transfer',
		entityId: transferGroupId,
		after: {
			fromAccountId: input.fromAccountId,
			toAccountId: input.toAccountId,
			amountCentavos: input.amountCentavos
		}
	});

	return { transferGroupId };
}

/**
 * Throws if `businessDate` is inside a completed (non-reopened) day-close for this
 * hotel and `finance_settings.lockOnDayClose` is on. Every dated write in Finance
 * (`recordCashMovement`, expense payout, receivable settlement) runs this first.
 */
export async function assertBusinessDateOpen(
	hotelId: string,
	businessDate: string,
	tx?: Tx
): Promise<void> {
	const runner = tx ?? db;
	const [settings] = await runner
		.select({ lock: financeSettings.lockOnDayClose })
		.from(financeSettings)
		.where(eq(financeSettings.hotelId, hotelId))
		.limit(1);
	if (settings && settings.lock === false) return;

	const [closed] = await runner
		.select({ id: dayCloses.id, reopenedAt: dayCloses.reopenedAt })
		.from(dayCloses)
		.where(and(eq(dayCloses.hotelId, hotelId), eq(dayCloses.businessDate, businessDate)))
		.limit(1);
	if (closed && !closed.reopenedAt) {
		throw new FinanceError(
			`${businessDate} is closed. A manager must reopen that day before anything dated on it can change.`
		);
	}
}

export interface AccountPositionRow {
	accountId: string;
	name: string;
	kind: string;
	openingCentavos: number;
	inCentavos: number;
	outCentavos: number;
	closingCentavos: number;
}

/**
 * Per-account opening / in / out / closing for a date range. Opening = the account's
 * `openingBalanceCentavos` plus every non-voided movement strictly before `from`;
 * with no range it just reports current balances (opening = closing = current).
 */
export async function getCashPosition(
	hotelId: string,
	range?: { from: string; to: string }
): Promise<AccountPositionRow[]> {
	const accounts = await db
		.select()
		.from(cashAccounts)
		.where(and(eq(cashAccounts.hotelId, hotelId), eq(cashAccounts.isActive, true)))
		.orderBy(asc(cashAccounts.sortOrder), asc(cashAccounts.name));

	if (!range) {
		return accounts.map((a) => ({
			accountId: a.id,
			name: a.name,
			kind: a.kind,
			openingCentavos: a.currentBalanceCentavos,
			inCentavos: 0,
			outCentavos: 0,
			closingCentavos: a.currentBalanceCentavos
		}));
	}

	const rows = await db
		.select({
			cashAccountId: cashMovements.cashAccountId,
			direction: cashMovements.direction,
			businessDate: cashMovements.businessDate,
			amountCentavos: cashMovements.amountCentavos
		})
		.from(cashMovements)
		.where(and(eq(cashMovements.hotelId, hotelId), sql`${cashMovements.voidedAt} is null`));

	return accounts.map((a) => {
		let opening = a.openingBalanceCentavos;
		let inC = 0;
		let outC = 0;
		for (const m of rows) {
			if (m.cashAccountId !== a.id) continue;
			const signed = m.direction === 'in' ? m.amountCentavos : -m.amountCentavos;
			if (m.businessDate < range.from) opening += signed;
			else if (m.businessDate <= range.to) {
				if (m.direction === 'in') inC += m.amountCentavos;
				else outC += m.amountCentavos;
			}
		}
		return {
			accountId: a.id,
			name: a.name,
			kind: a.kind,
			openingCentavos: opening,
			inCentavos: inC,
			outCentavos: outC,
			closingCentavos: opening + inC - outC
		};
	});
}

export interface MovementFilters {
	from?: string;
	to?: string;
	cashAccountId?: string;
	direction?: CashDirection;
	category?: CashCategory;
	includeVoided?: boolean;
	limit?: number;
}

/** The Cash-page ledger list, newest first, with the account name joined in. */
export async function listMovements(hotelId: string, filters: MovementFilters = {}) {
	const conds = [eq(cashMovements.hotelId, hotelId)];
	if (filters.from) conds.push(gte(cashMovements.businessDate, filters.from));
	if (filters.to) conds.push(lte(cashMovements.businessDate, filters.to));
	if (filters.cashAccountId) conds.push(eq(cashMovements.cashAccountId, filters.cashAccountId));
	if (filters.direction) conds.push(eq(cashMovements.direction, filters.direction));
	if (filters.category) conds.push(eq(cashMovements.category, filters.category));
	if (!filters.includeVoided) conds.push(sql`${cashMovements.voidedAt} is null`);

	return db
		.select({
			id: cashMovements.id,
			businessDate: cashMovements.businessDate,
			occurredAt: cashMovements.occurredAt,
			direction: cashMovements.direction,
			category: cashMovements.category,
			amountCentavos: cashMovements.amountCentavos,
			accountName: cashAccounts.name,
			cashAccountId: cashMovements.cashAccountId,
			counterpartyName: cashMovements.counterpartyName,
			sourceType: cashMovements.sourceType,
			sourceId: cashMovements.sourceId,
			memo: cashMovements.memo,
			voidedAt: cashMovements.voidedAt,
			voidReason: cashMovements.voidReason
		})
		.from(cashMovements)
		.innerJoin(cashAccounts, eq(cashAccounts.id, cashMovements.cashAccountId))
		.where(and(...conds))
		.orderBy(desc(cashMovements.occurredAt))
		.limit(filters.limit ?? 500);
}

/** Records a hand-entered movement (owner contribution/draw, other revenue, an
 *  adjustment) not produced by another module. */
export async function recordManualMovement(input: {
	hotelId: string;
	businessDate: string;
	direction: CashDirection;
	category: CashCategory;
	cashAccountId: string;
	amountCentavos: number;
	counterpartyName?: string | null;
	memo?: string | null;
	actor: SessionUser | null;
}): Promise<string> {
	const id = await recordCashMovement({ ...input, sourceType: 'manual' });
	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'finance.manual_cash_movement',
		entityType: 'cash_movement',
		entityId: id,
		after: {
			direction: input.direction,
			category: input.category,
			amountCentavos: input.amountCentavos
		}
	});
	return id;
}

/** Convenience for callers that only need one account (defaults, receipts). */
export async function getAccount(hotelId: string, accountId: string) {
	const [a] = await db
		.select()
		.from(cashAccounts)
		.where(and(eq(cashAccounts.id, accountId), eq(cashAccounts.hotelId, hotelId)))
		.limit(1);
	return a ?? null;
}
