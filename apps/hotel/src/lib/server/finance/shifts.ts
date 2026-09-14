import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index';
import {
	cashAccounts,
	cashMovements,
	cashierShifts,
	expenseCategories,
	expenses,
	financeSettings,
	hotels,
	payments,
	shiftEvents,
	users,
	type CashierShift
} from '../db/schema/index';
import { writeAudit } from '../audit';
import type { SessionUser } from '../auth/session';
import { FinanceError, businessDateFor, type Tx } from './shared';
import { expectedShiftCash, inputVatOf } from './calc';
import { recordCashMovement } from './cash';

export { expectedShiftCash } from './calc';

/**
 * The cashier's accountability wrapper around a drawer:
 *   expected cash at close = opening float
 *                          + cash movements INTO the drawer during the shift
 *                          − cash movements OUT of the drawer during the shift.
 * `variance = counted − expected`; a non-zero variance posts an `adjustment`
 * movement so the drawer account's running balance always matches the count.
 * Only `cash` payments touch a drawer — card / e-wallet / cheque land in a bank
 * account and never appear in a shift's cash math.
 */

export async function openShift(input: {
	hotelId: string;
	cashAccountId: string;
	businessDate: string;
	openingFloatCentavos: number;
	actor: SessionUser | null;
}): Promise<{ shiftId: string }> {
	if (!Number.isInteger(input.openingFloatCentavos) || input.openingFloatCentavos < 0) {
		throw new FinanceError('Opening float must be zero or a positive amount.');
	}
	const [account] = await db
		.select()
		.from(cashAccounts)
		.where(and(eq(cashAccounts.id, input.cashAccountId), eq(cashAccounts.hotelId, input.hotelId)))
		.limit(1);
	if (!account || !account.isActive) throw new FinanceError('That cash account was not found.');
	if (account.kind !== 'cash_drawer')
		throw new FinanceError('A shift can only be opened on a cash-drawer account.');

	try {
		const [row] = await db
			.insert(cashierShifts)
			.values({
				hotelId: input.hotelId,
				cashAccountId: input.cashAccountId,
				businessDate: input.businessDate,
				openedByUserId: input.actor?.id ?? null,
				openingFloatCentavos: input.openingFloatCentavos
			})
			.returning({ id: cashierShifts.id });

		await writeAudit({
			hotelId: input.hotelId,
			actor: input.actor,
			action: 'finance.open_shift',
			entityType: 'cashier_shift',
			entityId: row!.id,
			after: {
				cashAccountId: input.cashAccountId,
				openingFloatCentavos: input.openingFloatCentavos
			}
		});
		return { shiftId: row!.id };
	} catch (e) {
		// The partial unique index `cashier_shifts_one_open_per_drawer`.
		if (e instanceof Error && /one_open_per_drawer|unique/i.test(e.message)) {
			throw new FinanceError('A shift is already open on this drawer — close it first.');
		}
		throw e;
	}
}

export async function getOpenShiftForDrawer(
	hotelId: string,
	cashAccountId: string
): Promise<CashierShift | null> {
	const [row] = await db
		.select()
		.from(cashierShifts)
		.where(
			and(
				eq(cashierShifts.hotelId, hotelId),
				eq(cashierShifts.cashAccountId, cashAccountId),
				eq(cashierShifts.status, 'open')
			)
		)
		.limit(1);
	return row ?? null;
}

/** The open shift on the hotel's default drawer — what the front desk banner and the
 *  cash-payment path use when the cashier doesn't pick a drawer explicitly. */
export async function getDefaultOpenShift(hotelId: string): Promise<CashierShift | null> {
	const [settings] = await db
		.select({ drawer: financeSettings.defaultDrawerAccountId })
		.from(financeSettings)
		.where(eq(financeSettings.hotelId, hotelId))
		.limit(1);
	if (settings?.drawer) return getOpenShiftForDrawer(hotelId, settings.drawer);

	// No configured default — fall back to any open shift for the hotel.
	const [row] = await db
		.select()
		.from(cashierShifts)
		.where(and(eq(cashierShifts.hotelId, hotelId), eq(cashierShifts.status, 'open')))
		.orderBy(desc(cashierShifts.openedAt))
		.limit(1);
	return row ?? null;
}

export interface ShiftReconciliation {
	shift: CashierShift;
	drawerName: string;
	openedByName: string | null;
	closedByName: string | null;
	chargebackCollectedByName: string | null;
	openingFloatCentavos: number;
	cashInCentavos: number;
	cashOutCentavos: number;
	expectedCashCentavos: number;
	/** Non-null once closed. */
	countedCashCentavos: number | null;
	varianceCentavos: number | null;
	/** Every non-voided payment rung on this shift, grouped by tender. */
	byMethod: { method: string; count: number; amountCentavos: number }[];
	events: {
		id: string;
		kind: string;
		amountCentavos: number;
		reason: string | null;
		createdAt: Date;
	}[];
	movements: {
		id: string;
		direction: string;
		category: string;
		amountCentavos: number;
		memo: string | null;
		occurredAt: Date;
	}[];
}

export async function getShiftReconciliation(
	hotelId: string,
	shiftId: string
): Promise<ShiftReconciliation | null> {
	const [shift] = await db
		.select()
		.from(cashierShifts)
		.where(and(eq(cashierShifts.id, shiftId), eq(cashierShifts.hotelId, hotelId)))
		.limit(1);
	if (!shift) return null;

	const [drawer] = await db
		.select()
		.from(cashAccounts)
		.where(eq(cashAccounts.id, shift.cashAccountId))
		.limit(1);

	const [openedBy, closedBy, chargebackCollectedBy] = await Promise.all([
		shift.openedByUserId
			? db
					.select({ name: users.name })
					.from(users)
					.where(eq(users.id, shift.openedByUserId))
					.limit(1)
			: Promise.resolve([]),
		shift.closedByUserId
			? db
					.select({ name: users.name })
					.from(users)
					.where(eq(users.id, shift.closedByUserId))
					.limit(1)
			: Promise.resolve([]),
		shift.varianceChargebackCollectedByUserId
			? db
					.select({ name: users.name })
					.from(users)
					.where(eq(users.id, shift.varianceChargebackCollectedByUserId))
					.limit(1)
			: Promise.resolve([])
	]);

	const movementRows = await db
		.select()
		.from(cashMovements)
		.where(
			and(
				eq(cashMovements.shiftId, shiftId),
				eq(cashMovements.cashAccountId, shift.cashAccountId),
				sql`${cashMovements.voidedAt} is null`
			)
		)
		.orderBy(desc(cashMovements.occurredAt));

	let cashIn = 0;
	let cashOut = 0;
	for (const m of movementRows) {
		if (m.direction === 'in') cashIn += m.amountCentavos;
		else cashOut += m.amountCentavos;
	}
	const expected = expectedShiftCash(shift.openingFloatCentavos, cashIn, cashOut);

	const paymentRows = await db
		.select({ method: payments.method, amountCentavos: payments.amountCentavos })
		.from(payments)
		.where(
			and(
				eq(payments.shiftId, shiftId),
				sql`${payments.voidedAt} is null`,
				eq(payments.status, 'paid')
			)
		);
	const methodMap = new Map<string, { count: number; amountCentavos: number }>();
	for (const p of paymentRows) {
		const cur = methodMap.get(p.method) ?? { count: 0, amountCentavos: 0 };
		cur.count += 1;
		cur.amountCentavos += p.amountCentavos;
		methodMap.set(p.method, cur);
	}

	const eventRows = await db
		.select()
		.from(shiftEvents)
		.where(eq(shiftEvents.shiftId, shiftId))
		.orderBy(desc(shiftEvents.createdAt));

	return {
		shift,
		drawerName: drawer?.name ?? 'Drawer',
		openedByName: openedBy[0]?.name ?? null,
		closedByName: closedBy[0]?.name ?? null,
		chargebackCollectedByName: chargebackCollectedBy[0]?.name ?? null,
		openingFloatCentavos: shift.openingFloatCentavos,
		cashInCentavos: cashIn,
		cashOutCentavos: cashOut,
		expectedCashCentavos: expected,
		countedCashCentavos: shift.countedCashCentavos,
		varianceCentavos: shift.varianceCentavos,
		byMethod: [...methodMap.entries()].map(([method, v]) => ({ method, ...v })),
		events: eventRows.map((e) => ({
			id: e.id,
			kind: e.kind,
			amountCentavos: e.amountCentavos,
			reason: e.reason,
			createdAt: e.createdAt
		})),
		movements: movementRows.map((m) => ({
			id: m.id,
			direction: m.direction,
			category: m.category,
			amountCentavos: m.amountCentavos,
			memo: m.memo,
			occurredAt: m.occurredAt
		}))
	};
}

export type ShiftEventKind = 'payout' | 'cash_drop' | 'pickup' | 'adjustment';

/** A non-payment cash move during an open shift. Writes the `shift_events` row and
 *  the matching `cash_movements` (paired, for a drop/pickup that also hits a bank). */
export async function addShiftEvent(input: {
	hotelId: string;
	shiftId: string;
	kind: ShiftEventKind;
	amountCentavos: number;
	/** Only consulted for `adjustment` — whether the drawer went up (`in`) or down (`out`). */
	direction?: 'in' | 'out';
	reason?: string | null;
	/** `payout` only — when set, the payout is also recorded as a paid `expenses`
	 *  row (category + optional VAT), so a drawer payout shows up everywhere an
	 *  expense does, not just as an unlabelled cash-out. The `reason` ("paid to /
	 *  for") becomes the expense description + the cash-movement counterparty. */
	expenseCategoryId?: string | null;
	isVatable?: boolean;
	actor: SessionUser | null;
}): Promise<void> {
	if (!Number.isInteger(input.amountCentavos) || input.amountCentavos <= 0) {
		throw new FinanceError('Enter a positive amount.');
	}

	await db.transaction(async (tx: Tx) => {
		const [shift] = await tx
			.select()
			.from(cashierShifts)
			.where(and(eq(cashierShifts.id, input.shiftId), eq(cashierShifts.hotelId, input.hotelId)))
			.limit(1);
		if (!shift) throw new FinanceError('Shift not found.');
		if (shift.status !== 'open') throw new FinanceError('That shift is already closed.');

		const [ev] = await tx
			.insert(shiftEvents)
			.values({
				shiftId: input.shiftId,
				kind: input.kind,
				amountCentavos: input.amountCentavos,
				reason: input.reason?.trim() || null,
				recordedByUserId: input.actor?.id ?? null
			})
			.returning({ id: shiftEvents.id });

		const common = {
			hotelId: input.hotelId,
			businessDate: shift.businessDate,
			cashAccountId: shift.cashAccountId,
			amountCentavos: input.amountCentavos,
			sourceType: 'shift_event',
			sourceId: ev!.id,
			shiftId: input.shiftId,
			actor: input.actor
		} as const;

		if (input.kind === 'payout') {
			if (input.expenseCategoryId) {
				// Bridge the payout to a real expense record.
				const [cat] = await tx
					.select({ id: expenseCategories.id, group: expenseCategories.group, name: expenseCategories.name })
					.from(expenseCategories)
					.where(
						and(
							eq(expenseCategories.id, input.expenseCategoryId),
							eq(expenseCategories.hotelId, input.hotelId)
						)
					)
					.limit(1);
				if (!cat) throw new FinanceError('Pick a valid expense category.');

				const [h] = await tx
					.select({ bps: hotels.vatRateBps })
					.from(hotels)
					.where(eq(hotels.id, input.hotelId))
					.limit(1);
				const inputVat = input.isVatable
					? Math.min(input.amountCentavos, inputVatOf(input.amountCentavos, h?.bps ?? 1200))
					: 0;
				const payee = input.reason?.trim() || '';
				const description = payee || 'Cash payout';

				const [exp] = await tx
					.insert(expenses)
					.values({
						hotelId: input.hotelId,
						expenseDate: shift.businessDate,
						categoryId: cat.id,
						description,
						grossCentavos: input.amountCentavos,
						inputVatCentavos: inputVat,
						netOfVatCentavos: input.amountCentavos - inputVat,
						isVatable: !!input.isVatable,
						status: 'paid',
						paidFromAccountId: shift.cashAccountId,
						paidAt: new Date(),
						createdByUserId: input.actor?.id ?? null,
						approvedByUserId: input.actor?.id ?? null,
						approvedAt: new Date()
					})
					.returning({ id: expenses.id });

				const category =
					cat.group === 'payroll'
						? 'payroll'
						: cat.group === 'taxes_licenses'
							? 'statutory_remittance'
							: 'expense';

				await recordCashMovement(
					{
						...common,
						sourceType: 'expense',
						sourceId: exp!.id,
						direction: 'out',
						category,
						...(payee ? { counterpartyType: 'vendor' as const, counterpartyName: payee } : {}),
						memo: `${cat.name} — ${description}`
					},
					tx
				);

				await writeAudit({
					hotelId: input.hotelId,
					actor: input.actor,
					action: 'finance.create_expense',
					entityType: 'expense',
					entityId: exp!.id,
					after: { grossCentavos: input.amountCentavos, status: 'paid', via: 'shift_payout' }
				});
			} else {
				await recordCashMovement(
					{
						...common,
						direction: 'out',
						category: 'expense',
						memo: input.reason?.trim() || 'Cash payout'
					},
					tx
				);
			}
		} else if (input.kind === 'adjustment') {
			await recordCashMovement(
				{
					...common,
					direction: input.direction ?? 'out',
					category: 'adjustment',
					memo: input.reason?.trim() || 'Drawer adjustment'
				},
				tx
			);
		} else {
			// cash_drop = drawer → bank; pickup = bank → drawer (float top-up).
			const [settings] = await tx
				.select({ bank: financeSettings.defaultBankAccountId })
				.from(financeSettings)
				.where(eq(financeSettings.hotelId, input.hotelId))
				.limit(1);
			if (!settings?.bank) {
				throw new FinanceError(
					'Set a default bank account in Finance settings before recording drops or pickups.'
				);
			}
			const groupId = ev!.id;
			const drawerDir = input.kind === 'cash_drop' ? 'out' : 'in';
			const bankDir = input.kind === 'cash_drop' ? 'in' : 'out';
			await recordCashMovement(
				{
					...common,
					direction: drawerDir,
					category: drawerDir === 'out' ? 'transfer_out' : 'transfer_in',
					transferGroupId: groupId,
					memo: input.kind === 'cash_drop' ? 'Cash drop to bank' : 'Float pickup from bank'
				},
				tx
			);
			await recordCashMovement(
				{
					hotelId: input.hotelId,
					businessDate: shift.businessDate,
					cashAccountId: settings.bank,
					amountCentavos: input.amountCentavos,
					direction: bankDir,
					category: bankDir === 'in' ? 'transfer_in' : 'transfer_out',
					sourceType: 'shift_event',
					sourceId: ev!.id,
					shiftId: input.shiftId,
					transferGroupId: groupId,
					memo: input.kind === 'cash_drop' ? 'Cash drop from drawer' : 'Float pickup to drawer',
					actor: input.actor
				},
				tx
			);
		}
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'finance.shift_event',
		entityType: 'cashier_shift',
		entityId: input.shiftId,
		after: { kind: input.kind, amountCentavos: input.amountCentavos }
	});
}

export async function closeShift(input: {
	hotelId: string;
	shiftId: string;
	countedCentavos: number;
	denominations?: Record<string, number> | null;
	notes?: string | null;
	actor: SessionUser | null;
}): Promise<{ varianceCentavos: number; expectedCentavos: number }> {
	if (!Number.isInteger(input.countedCentavos) || input.countedCentavos < 0) {
		throw new FinanceError('Enter the counted cash as a valid amount.');
	}

	const recon = await getShiftReconciliation(input.hotelId, input.shiftId);
	if (!recon) throw new FinanceError('Shift not found.');
	if (recon.shift.status !== 'open') throw new FinanceError('That shift is already closed.');

	const expected = recon.expectedCashCentavos;
	const variance = input.countedCentavos - expected;

	await db.transaction(async (tx: Tx) => {
		// Post the over/short so the drawer's running balance matches the count.
		if (variance !== 0) {
			await recordCashMovement(
				{
					hotelId: input.hotelId,
					businessDate: recon.shift.businessDate,
					cashAccountId: recon.shift.cashAccountId,
					amountCentavos: Math.abs(variance),
					direction: variance > 0 ? 'in' : 'out',
					category: 'adjustment',
					sourceType: 'shift_event',
					sourceId: input.shiftId,
					shiftId: input.shiftId,
					memo: variance > 0 ? 'Shift close — cash over' : 'Shift close — cash short',
					actor: input.actor
				},
				tx
			);
		}

		await tx
			.update(cashierShifts)
			.set({
				status: 'closed',
				closedByUserId: input.actor?.id ?? null,
				closedAt: new Date(),
				countedCashCentavos: input.countedCentavos,
				expectedCashCentavos: expected,
				varianceCentavos: variance,
				denominations: input.denominations ?? null,
				closeNotes: input.notes?.trim() || null,
				updatedAt: new Date()
			})
			.where(eq(cashierShifts.id, input.shiftId));
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'finance.close_shift',
		entityType: 'cashier_shift',
		entityId: input.shiftId,
		after: {
			countedCentavos: input.countedCentavos,
			expectedCentavos: expected,
			varianceCentavos: variance
		}
	});

	return { varianceCentavos: variance, expectedCentavos: expected };
}

/** List for the Shifts page — recent shifts with cashier names + variance. */
export async function listShifts(hotelId: string, limit = 60) {
	const opened = users;
	return db
		.select({
			id: cashierShifts.id,
			businessDate: cashierShifts.businessDate,
			status: cashierShifts.status,
			drawerName: cashAccounts.name,
			openedByName: opened.name,
			openedAt: cashierShifts.openedAt,
			closedAt: cashierShifts.closedAt,
			openingFloatCentavos: cashierShifts.openingFloatCentavos,
			expectedCashCentavos: cashierShifts.expectedCashCentavos,
			countedCashCentavos: cashierShifts.countedCashCentavos,
			varianceCentavos: cashierShifts.varianceCentavos,
			varianceChargebackStatus: cashierShifts.varianceChargebackStatus,
			varianceChargebackCentavos: cashierShifts.varianceChargebackCentavos
		})
		.from(cashierShifts)
		.innerJoin(cashAccounts, eq(cashAccounts.id, cashierShifts.cashAccountId))
		.leftJoin(opened, eq(opened.id, cashierShifts.openedByUserId))
		.where(eq(cashierShifts.hotelId, hotelId))
		.orderBy(desc(cashierShifts.openedAt))
		.limit(limit);
}

/**
 * Charges a closed shift's shortage back to the cashier who ran it (`opened_by_user_id`) —
 * a claim, not a cash movement: nothing moves until `collectShiftChargeback` runs. Only a
 * shortage (`variance_centavos < 0`) can be charged back; an overage is never billed to
 * anyone. `amountCentavos` may be less than the full shortfall (partial charge-back) but
 * never more.
 */
export async function chargeBackShiftVariance(input: {
	hotelId: string;
	shiftId: string;
	amountCentavos?: number;
	note: string;
	actor: SessionUser | null;
}): Promise<void> {
	const note = input.note.trim();
	if (!note) throw new FinanceError('Enter a note explaining the charge-back.');

	const [shift] = await db
		.select()
		.from(cashierShifts)
		.where(and(eq(cashierShifts.id, input.shiftId), eq(cashierShifts.hotelId, input.hotelId)))
		.limit(1);
	if (!shift) throw new FinanceError('Shift not found.');
	if (shift.status !== 'closed') throw new FinanceError('Close the shift before charging back a shortage.');
	if ((shift.varianceCentavos ?? 0) >= 0) {
		throw new FinanceError('Only a shortage can be charged back — this shift has no shortfall.');
	}
	if (shift.varianceChargebackStatus !== 'none') {
		throw new FinanceError('This shortage has already been charged back or written off.');
	}

	const shortfall = Math.abs(shift.varianceCentavos!);
	const amount =
		input.amountCentavos != null
			? Math.min(shortfall, Math.max(0, Math.round(input.amountCentavos)))
			: shortfall;
	if (amount <= 0) throw new FinanceError('Enter an amount greater than zero.');

	const flipped = await db
		.update(cashierShifts)
		.set({
			varianceChargebackStatus: 'owed',
			varianceChargebackCentavos: amount,
			varianceChargebackNote: note,
			varianceChargebackAt: new Date(),
			varianceChargebackByUserId: input.actor?.id ?? null,
			updatedAt: new Date()
		})
		.where(and(eq(cashierShifts.id, input.shiftId), eq(cashierShifts.varianceChargebackStatus, 'none')))
		.returning({ id: cashierShifts.id });
	if (flipped.length === 0) throw new FinanceError('This shift just changed — reload and try again.');

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'finance.shift_chargeback',
		entityType: 'cashier_shift',
		entityId: input.shiftId,
		after: { amountCentavos: amount, note }
	});
}

/**
 * Records that an "owed" charge-back was actually recovered in cash — posts a matching
 * `cash_movements` in-flow (today's business date, not the shift's own; the money changes
 * hands now, possibly days after the shift ran) and flips the shift to `collected`.
 * Deliberately does **not** tag the movement with `shiftId`: that column drives the shift
 * reconciliation view's live "expected cash" recompute (`getShiftReconciliation`), and a
 * recovery posted after close must never retroactively change a closed shift's own figures.
 * `sourceType`/`sourceId` still link it back to the shift for the cash ledger / reports.
 */
export async function collectShiftChargeback(input: {
	hotelId: string;
	shiftId: string;
	cashAccountId: string;
	actor: SessionUser | null;
}): Promise<void> {
	const [shift] = await db
		.select()
		.from(cashierShifts)
		.where(and(eq(cashierShifts.id, input.shiftId), eq(cashierShifts.hotelId, input.hotelId)))
		.limit(1);
	if (!shift) throw new FinanceError('Shift not found.');
	if (shift.varianceChargebackStatus !== 'owed') {
		throw new FinanceError('Nothing is currently owed for this shift.');
	}

	const [hotel] = await db.select({ timezone: hotels.timezone }).from(hotels).where(eq(hotels.id, input.hotelId)).limit(1);
	const businessDate = businessDateFor(hotel?.timezone ?? 'Asia/Manila');
	const cashierName = shift.openedByUserId
		? (
				await db.select({ name: users.name }).from(users).where(eq(users.id, shift.openedByUserId)).limit(1)
			)[0]?.name ?? null
		: null;

	await db.transaction(async (tx: Tx) => {
		await recordCashMovement(
			{
				hotelId: input.hotelId,
				businessDate,
				cashAccountId: input.cashAccountId,
				amountCentavos: shift.varianceChargebackCentavos!,
				direction: 'in',
				category: 'adjustment',
				counterpartyType: 'employee',
				counterpartyName: cashierName,
				counterpartyId: shift.openedByUserId ?? undefined,
				sourceType: 'shift_variance_chargeback',
				sourceId: shift.id,
				memo: `Shift shortage recovered${cashierName ? ` — ${cashierName}` : ''} (${shift.businessDate} shift)`,
				actor: input.actor
			},
			tx
		);

		const flipped = await tx
			.update(cashierShifts)
			.set({
				varianceChargebackStatus: 'collected',
				varianceChargebackCollectedAt: new Date(),
				varianceChargebackCollectedByUserId: input.actor?.id ?? null,
				updatedAt: new Date()
			})
			.where(and(eq(cashierShifts.id, input.shiftId), eq(cashierShifts.varianceChargebackStatus, 'owed')))
			.returning({ id: cashierShifts.id });
		if (flipped.length === 0) throw new FinanceError('This shift just changed — reload and try again.');
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'finance.shift_chargeback_collected',
		entityType: 'cashier_shift',
		entityId: input.shiftId,
		after: { amountCentavos: shift.varianceChargebackCentavos, cashAccountId: input.cashAccountId }
	});
}

/** Closes out an "owed" charge-back without collecting it — the hotel absorbs the loss
 *  formally instead of leaving a bare claim hanging with no resolution. */
export async function writeOffShiftChargeback(input: {
	hotelId: string;
	shiftId: string;
	note: string;
	actor: SessionUser | null;
}): Promise<void> {
	const note = input.note.trim();
	if (!note) throw new FinanceError('Enter a reason for writing this off.');

	const [shift] = await db
		.select()
		.from(cashierShifts)
		.where(and(eq(cashierShifts.id, input.shiftId), eq(cashierShifts.hotelId, input.hotelId)))
		.limit(1);
	if (!shift) throw new FinanceError('Shift not found.');
	if (shift.varianceChargebackStatus !== 'owed') {
		throw new FinanceError('Nothing is currently owed for this shift.');
	}

	const flipped = await db
		.update(cashierShifts)
		.set({
			varianceChargebackStatus: 'written_off',
			varianceChargebackNote: `${shift.varianceChargebackNote ?? ''}\n\nWritten off: ${note}`.trim(),
			updatedAt: new Date()
		})
		.where(and(eq(cashierShifts.id, input.shiftId), eq(cashierShifts.varianceChargebackStatus, 'owed')))
		.returning({ id: cashierShifts.id });
	if (flipped.length === 0) throw new FinanceError('This shift just changed — reload and try again.');

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'finance.shift_chargeback_written_off',
		entityType: 'cashier_shift',
		entityId: input.shiftId,
		after: { note }
	});
}
