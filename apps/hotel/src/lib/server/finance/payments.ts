import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index';
import {
	cashAccounts,
	cashMovements,
	guests,
	hotels,
	orders,
	payments,
	type Payment
} from '../db/schema/index';
import { writeAudit } from '../audit';
import type { SessionUser } from '../auth/session';
import {
	FolioError,
	ensureFolio,
	getFolioDetail,
	getOrderIdForTarget,
	type FolioTarget
} from '../folio';
import { FinanceError, businessDateFor, pesos, type Tx } from './shared';
import { recordCashMovement } from './cash';
import { getFinanceSettings } from './settings';
import { getDefaultOpenShift } from './shifts';
import { getBirSettings, issueOfficialReceipt } from './documents';

export type PaymentMethod = Payment['method'];
export type PaymentPurpose = Payment['purpose'];

/** Methods that physically hit a cash drawer (and therefore need an open shift). */
const DRAWER_METHODS = new Set<PaymentMethod>(['cash']);

/**
 * Where a payment of `method` should land: the open drawer shift for cash, the
 * default bank/e-wallet account otherwise. Throws a `FinanceError` when nothing is
 * configured (or a shift is required and none is open). Shared by the front-desk
 * `recordPayment` path and the walk-in booking creators.
 */
export async function resolvePaymentAccount(
	hotelId: string,
	method: PaymentMethod
): Promise<{ cashAccountId: string; shiftId: string | null }> {
	const settings = await getFinanceSettings(hotelId);
	if (DRAWER_METHODS.has(method)) {
		const openShift = await getDefaultOpenShift(hotelId);
		if (openShift) return { cashAccountId: openShift.cashAccountId, shiftId: openShift.id };
		if (settings.requireOpenShiftForCashPayment) {
			throw new FinanceError('Open a cashier shift before taking a cash payment.');
		}
		if (!settings.defaultDrawerAccountId)
			throw new FinanceError('No cash drawer is set up. Add one in Finance settings.');
		return { cashAccountId: settings.defaultDrawerAccountId, shiftId: null };
	}
	if (!settings.defaultBankAccountId) {
		throw new FinanceError(
			'No bank / e-wallet account is set up for non-cash payments. Add one in Finance settings.'
		);
	}
	return { cashAccountId: settings.defaultBankAccountId, shiftId: null };
}

export interface RecordPaymentInput {
	hotelId: string;
	target: FolioTarget;
	method: PaymentMethod;
	amountCentavos: number;
	purpose?: PaymentPurpose;
	/** Cash only — what the guest handed over. `change = tendered − amount`. */
	tenderedCentavos?: number | null;
	referenceNo?: string | null;
	bankName?: string | null;
	chequeDate?: string | null;
	/** Override the auto-picked account. */
	cashAccountId?: string | null;
	actor: SessionUser | null;
}

export interface RecordPaymentResult {
	paymentId: string;
	appliedCentavos: number;
	changeCentavos: number;
	newBalanceCentavos: number;
}

/**
 * Takes a payment against a folio (room or hall) at the front desk. Supports
 * deposits and partial settlement — `amountCentavos` may be anything from 1
 * centavo up to the current balance. Cash may be over-tendered (change is
 * returned); every other method must be for the exact amount applied.
 *
 * Writes the `payments` row **and** a matching `cash_movements` `in` row in one
 * transaction, so a payment can never exist without its cash-ledger entry.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
	const amount = input.amountCentavos;
	if (!Number.isInteger(amount) || amount <= 0)
		throw new FinanceError('Enter a payment amount greater than zero.');

	// Balance + folio id (folio is created on first touch by getFolioDetail).
	let folio;
	try {
		folio = await getFolioDetail(input.hotelId, input.target);
	} catch (e) {
		if (e instanceof FolioError) throw new FinanceError(e.message);
		throw e;
	}
	if (folio.balanceCentavos <= 0) throw new FinanceError('This folio has no outstanding balance.');
	if (amount > folio.balanceCentavos) {
		throw new FinanceError(
			`That's more than the ${pesos(folio.balanceCentavos)} balance. Enter ${pesos(folio.balanceCentavos)} or less` +
				(input.method === 'cash' ? ' — cash tendered can be higher, the change is returned.' : '.')
		);
	}

	const isCash = input.method === 'cash';
	let tendered: number | null = null;
	let change = 0;
	if (isCash) {
		tendered = input.tenderedCentavos ?? amount;
		if (!Number.isInteger(tendered) || tendered < amount) {
			throw new FinanceError('Cash tendered must be at least the amount being paid.');
		}
		change = tendered - amount;
	} else if (['card', 'gcash', 'maya', 'bank_transfer', 'cheque'].includes(input.method)) {
		if (!input.referenceNo?.trim()) {
			throw new FinanceError('Enter the reference / approval number for a non-cash payment.');
		}
	}

	const [hotel] = await db
		.select({ timezone: hotels.timezone })
		.from(hotels)
		.where(eq(hotels.id, input.hotelId))
		.limit(1);
	const businessDate = businessDateFor(hotel?.timezone ?? 'Asia/Manila');

	// Which account receives the money, and (for cash) which shift it's rung on.
	const resolved = await resolvePaymentAccount(input.hotelId, input.method);
	const cashAccountId = input.cashAccountId ?? resolved.cashAccountId;
	const shiftId = input.cashAccountId ? null : resolved.shiftId;

	const orderId = await getOrderIdForTarget(input.target);
	if (!orderId) throw new FinanceError('The booking behind this folio was not found.');

	const purpose: PaymentPurpose =
		input.purpose ?? (amount < folio.balanceCentavos ? 'deposit' : 'settlement');
	const category =
		purpose === 'deposit'
			? 'deposit'
			: input.target.kind === 'hall'
				? 'hall_revenue'
				: 'room_revenue';

	const guestName = await guestNameForOrder(orderId);

	const paymentId = await db.transaction(async (tx: Tx) => {
		const folioId = await ensureFolio(tx, input.hotelId, input.target);
		const [row] = await tx
			.insert(payments)
			.values({
				orderId,
				provider: input.method === 'paymongo' ? 'paymongo' : 'cash',
				method: input.method,
				purpose,
				status: 'paid',
				amountCentavos: amount,
				folioId,
				cashAccountId,
				shiftId,
				tenderedCentavos: tendered,
				changeCentavos: change,
				referenceNo: input.referenceNo?.trim() || null,
				bankName: input.bankName?.trim() || null,
				chequeDate: input.chequeDate || null,
				recordedByUserId: input.actor?.id ?? null,
				paidAt: new Date()
			})
			.returning({ id: payments.id });

		await recordCashMovement(
			{
				hotelId: input.hotelId,
				businessDate,
				direction: 'in',
				category,
				cashAccountId: cashAccountId!,
				amountCentavos: amount,
				counterpartyType: 'guest',
				counterpartyName: guestName,
				sourceType: 'payment',
				sourceId: row!.id,
				paymentId: row!.id,
				shiftId,
				memo: `${labelForMethod(input.method)} — ${input.target.kind} folio`,
				actor: input.actor
			},
			tx
		);

		return row!.id;
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'folio.record_payment',
		entityType: input.target.kind === 'room' ? 'booking' : 'hall_booking',
		entityId: input.target.kind === 'room' ? input.target.bookingId : input.target.hallBookingId,
		after: { method: input.method, amountCentavos: amount, changeCentavos: change, purpose }
	});

	// Issue the Official Receipt for this payment. Never fail a real payment over a
	// document post — a missing/exhausted OR series is logged for the cashier to
	// resolve in Finance → BIR, and the OR issues on first print instead.
	const s = await getBirSettings(input.hotelId).catch(() => null);
	if (s?.autoIssueReceiptOnPayment) {
		try {
			await issueOfficialReceipt(input.hotelId, paymentId, input.actor);
		} catch (e) {
			console.warn('recordPayment: could not issue official receipt', paymentId, e);
		}
	}

	return {
		paymentId,
		appliedCentavos: amount,
		changeCentavos: change,
		newBalanceCentavos: folio.balanceCentavos - amount
	};
}

/** Soft-void a payment and reverse its cash movement. Refuses on a `paymongo` row
 *  (those are reconciled through the webhook, not the desk) or an already-void row. */
export async function voidPayment(
	hotelId: string,
	paymentId: string,
	reason: string | null,
	actor: SessionUser | null
): Promise<void> {
	await db.transaction(async (tx: Tx) => {
		const [p] = await tx
			.select({ payment: payments, orderHotelId: orders.hotelId })
			.from(payments)
			.innerJoin(orders, eq(orders.id, payments.orderId))
			.where(eq(payments.id, paymentId))
			.limit(1);
		if (!p || p.orderHotelId !== hotelId) throw new FinanceError('Payment not found.');
		if (p.payment.voidedAt) throw new FinanceError('That payment is already voided.');
		if (p.payment.provider === 'paymongo') {
			throw new FinanceError(
				"An online (PayMongo) payment can't be voided at the desk — issue a refund instead."
			);
		}

		await tx
			.update(payments)
			.set({
				voidedAt: new Date(),
				voidedByUserId: actor?.id ?? null,
				voidReason: reason?.trim() || null
			})
			.where(eq(payments.id, paymentId));

		// Reverse every non-voided cash movement tied to this payment.
		const movements = await tx
			.select()
			.from(cashMovements)
			.where(and(eq(cashMovements.paymentId, paymentId), sql`${cashMovements.voidedAt} is null`));
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
					voidReason: reason?.trim() || 'Payment voided'
				})
				.where(eq(cashMovements.id, m.id));
		}
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'folio.void_payment',
		entityType: 'payment',
		entityId: paymentId,
		after: { reason: reason || null }
	});
}

export interface RefundInput {
	hotelId: string;
	target: FolioTarget;
	method: PaymentMethod;
	amountCentavos: number;
	referenceNo?: string | null;
	reason?: string | null;
	cashAccountId?: string | null;
	actor: SessionUser | null;
}

/** Pays money back out — used when a voided charge leaves the folio in credit, or a
 *  deposit is being returned. Writes a `refund`-purpose `payments` row (amount stored
 *  positive) and a `cash_movements` `out` row. */
export async function refundPayment(input: RefundInput): Promise<{ paymentId: string }> {
	if (!Number.isInteger(input.amountCentavos) || input.amountCentavos <= 0) {
		throw new FinanceError('Enter a refund amount greater than zero.');
	}
	let folio;
	try {
		folio = await getFolioDetail(input.hotelId, input.target);
	} catch (e) {
		if (e instanceof FolioError) throw new FinanceError(e.message);
		throw e;
	}
	const credit = -folio.balanceCentavos;
	if (credit <= 0) throw new FinanceError('There is no credit balance to refund on this folio.');
	if (input.amountCentavos > credit) {
		throw new FinanceError(`The folio credit is only ${pesos(credit)}.`);
	}

	const settings = await getFinanceSettings(input.hotelId);
	const [hotel] = await db
		.select({ timezone: hotels.timezone })
		.from(hotels)
		.where(eq(hotels.id, input.hotelId))
		.limit(1);
	const businessDate = businessDateFor(hotel?.timezone ?? 'Asia/Manila');

	let cashAccountId = input.cashAccountId ?? null;
	let shiftId: string | null = null;
	if (input.method === 'cash') {
		const openShift = await getDefaultOpenShift(input.hotelId);
		shiftId = openShift?.id ?? null;
		cashAccountId = cashAccountId ?? openShift?.cashAccountId ?? settings.defaultDrawerAccountId;
	} else {
		cashAccountId = cashAccountId ?? settings.defaultBankAccountId;
	}
	if (!cashAccountId) throw new FinanceError('No account is set up to pay the refund from.');

	const orderId = await getOrderIdForTarget(input.target);
	if (!orderId) throw new FinanceError('Booking not found.');

	const paymentId = await db.transaction(async (tx: Tx) => {
		const folioId = await ensureFolio(tx, input.hotelId, input.target);
		const [row] = await tx
			.insert(payments)
			.values({
				orderId,
				provider: 'cash',
				method: input.method,
				purpose: 'refund',
				status: 'paid',
				amountCentavos: -input.amountCentavos,
				folioId,
				cashAccountId,
				shiftId,
				referenceNo: input.referenceNo?.trim() || null,
				recordedByUserId: input.actor?.id ?? null,
				paidAt: new Date()
			})
			.returning({ id: payments.id });

		await recordCashMovement(
			{
				hotelId: input.hotelId,
				businessDate,
				direction: 'out',
				category: 'refund',
				cashAccountId: cashAccountId!,
				amountCentavos: input.amountCentavos,
				counterpartyType: 'guest',
				sourceType: 'payment',
				sourceId: row!.id,
				paymentId: row!.id,
				shiftId,
				memo: input.reason?.trim() || 'Folio refund',
				actor: input.actor
			},
			tx
		);
		return row!.id;
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'folio.refund_payment',
		entityType: input.target.kind === 'room' ? 'booking' : 'hall_booking',
		entityId: input.target.kind === 'room' ? input.target.bookingId : input.target.hallBookingId,
		after: {
			method: input.method,
			amountCentavos: input.amountCentavos,
			reason: input.reason || null
		}
	});

	return { paymentId };
}

/**
 * The full-settlement payment a walk-in creator writes inside its own transaction,
 * where the folio doesn't exist yet and there's no balance to check (the amount is
 * the booking's own freshly-priced total). Shares the `payments` + `cash_movements`
 * write with `recordPayment` but skips all the front-desk validation.
 */
export async function recordWalkInPayment(
	tx: Tx,
	input: {
		hotelId: string;
		orderId: string;
		target: FolioTarget;
		method: PaymentMethod;
		amountCentavos: number;
		tenderedCentavos?: number | null;
		referenceNo?: string | null;
		bankName?: string | null;
		chequeDate?: string | null;
		cashAccountId: string;
		shiftId?: string | null;
		businessDate: string;
		guestName?: string | null;
		actor: SessionUser | null;
	}
): Promise<string> {
	const isCash = input.method === 'cash';
	const tendered = isCash ? (input.tenderedCentavos ?? input.amountCentavos) : null;
	const change = isCash && tendered != null ? Math.max(0, tendered - input.amountCentavos) : 0;

	const folioId = await ensureFolio(tx, input.hotelId, input.target);
	const [row] = await tx
		.insert(payments)
		.values({
			orderId: input.orderId,
			provider: input.method === 'paymongo' ? 'paymongo' : 'cash',
			method: input.method,
			purpose: 'settlement',
			status: 'paid',
			amountCentavos: input.amountCentavos,
			folioId,
			cashAccountId: input.cashAccountId,
			shiftId: input.shiftId ?? null,
			tenderedCentavos: tendered,
			changeCentavos: change,
			referenceNo: input.referenceNo?.trim() || null,
			bankName: input.bankName?.trim() || null,
			chequeDate: input.chequeDate || null,
			recordedByUserId: input.actor?.id ?? null,
			paidAt: new Date()
		})
		.returning({ id: payments.id });

	await recordCashMovement(
		{
			hotelId: input.hotelId,
			businessDate: input.businessDate,
			direction: 'in',
			category: input.target.kind === 'hall' ? 'hall_revenue' : 'room_revenue',
			cashAccountId: input.cashAccountId,
			amountCentavos: input.amountCentavos,
			counterpartyType: 'guest',
			counterpartyName: input.guestName ?? null,
			sourceType: 'payment',
			sourceId: row!.id,
			paymentId: row!.id,
			shiftId: input.shiftId ?? null,
			memo: `Walk-in ${input.target.kind} — ${labelForMethod(input.method)}`,
			actor: input.actor
		},
		tx
	);

	return row!.id;
}

function labelForMethod(m: PaymentMethod): string {
	return (
		{
			cash: 'Cash',
			card: 'Card',
			gcash: 'GCash',
			maya: 'Maya',
			bank_transfer: 'Bank transfer',
			cheque: 'Cheque',
			paymongo: 'Online (PayMongo)',
			house_use: 'House use'
		} as Record<PaymentMethod, string>
	)[m];
}

async function guestNameForOrder(orderId: string): Promise<string | null> {
	const [row] = await db
		.select({ name: guests.fullName })
		.from(orders)
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.where(eq(orders.id, orderId))
		.limit(1);
	return row?.name ?? null;
}
