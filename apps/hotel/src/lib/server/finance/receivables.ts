import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index';
import {
	cashAccounts,
	cashMovements,
	hotels,
	payments,
	receivables,
	type Receivable
} from '../db/schema/index';
import { writeAudit } from '../audit';
import type { SessionUser } from '../auth/session';
import { ensureFolio, getFolioDetail, getOrderIdForTarget, type FolioTarget } from '../folio';
import { FinanceError, businessDateFor, pesos, type Tx } from './shared';
import { recordCashMovement } from './cash';
import { getFinanceSettings } from './settings';
import { getBirSettings } from './documents';
import { getDefaultOpenShift } from './shifts';
import type { PaymentMethod } from './payments';

/**
 * The "city ledger": a balance a guest or company still owes after checkout. Opened
 * by the manager override on checkout — the folio is squared with a `house_use`
 * payment (so it can close) and the debt moves here, to be collected later.
 */
export async function openReceivable(input: {
	hotelId: string;
	target: FolioTarget;
	billToName: string;
	billToCompany?: string | null;
	referenceNo?: string | null;
	notes?: string | null;
	actor: SessionUser | null;
}): Promise<{ receivableId: string; amountCentavos: number }> {
	const folio = await getFolioDetail(input.hotelId, input.target);
	if (folio.balanceCentavos <= 0)
		throw new FinanceError('This folio has nothing outstanding to move to the city ledger.');
	const amount = folio.balanceCentavos;

	const orderId = await getOrderIdForTarget(input.target);
	if (!orderId) throw new FinanceError('Booking not found.');

	const receivableId = await db.transaction(async (tx: Tx) => {
		const folioId = await ensureFolio(tx, input.hotelId, input.target);

		// Square the folio so check-out's balance gate passes — this isn't cash, so
		// no cash_movements row; the debt is now carried by the receivable.
		await tx.insert(payments).values({
			orderId,
			provider: 'cash',
			method: 'house_use',
			purpose: 'settlement',
			status: 'paid',
			amountCentavos: amount,
			folioId,
			recordedByUserId: input.actor?.id ?? null,
			paidAt: new Date()
		});

		const [row] = await tx
			.insert(receivables)
			.values({
				hotelId: input.hotelId,
				folioId,
				bookingId: input.target.kind === 'room' ? input.target.bookingId : null,
				hallBookingId: input.target.kind === 'hall' ? input.target.hallBookingId : null,
				billToName: input.billToName.trim(),
				billToCompany: input.billToCompany?.trim() || null,
				referenceNo: input.referenceNo?.trim() || null,
				originalAmountCentavos: amount,
				outstandingCentavos: amount,
				openedByUserId: input.actor?.id ?? null,
				notes: input.notes?.trim() || null
			})
			.returning({ id: receivables.id });
		return row!.id;
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'finance.open_receivable',
		entityType: 'receivable',
		entityId: receivableId,
		after: { amountCentavos: amount, billToName: input.billToName }
	});

	return { receivableId, amountCentavos: amount };
}

export async function settleReceivable(input: {
	hotelId: string;
	receivableId: string;
	method: PaymentMethod;
	amountCentavos: number;
	referenceNo?: string | null;
	actor: SessionUser | null;
}): Promise<{ outstandingCentavos: number; status: Receivable['status'] }> {
	if (!Number.isInteger(input.amountCentavos) || input.amountCentavos <= 0) {
		throw new FinanceError('Enter a collection amount greater than zero.');
	}

	const [r] = await db
		.select()
		.from(receivables)
		.where(and(eq(receivables.id, input.receivableId), eq(receivables.hotelId, input.hotelId)))
		.limit(1);
	if (!r) throw new FinanceError('Receivable not found.');
	if (r.status === 'settled' || r.status === 'written_off')
		throw new FinanceError('This receivable is already closed.');
	if (input.amountCentavos > r.outstandingCentavos) {
		throw new FinanceError(`Only ${pesos(r.outstandingCentavos)} is still outstanding.`);
	}

	const settings = await getFinanceSettings(input.hotelId);
	const [hotel] = await db
		.select({ timezone: hotels.timezone })
		.from(hotels)
		.where(eq(hotels.id, input.hotelId))
		.limit(1);
	const businessDate = businessDateFor(hotel?.timezone ?? 'Asia/Manila');

	let cashAccountId: string | null;
	let shiftId: string | null = null;
	if (input.method === 'cash') {
		const openShift = await getDefaultOpenShift(input.hotelId);
		shiftId = openShift?.id ?? null;
		cashAccountId = openShift?.cashAccountId ?? settings.defaultDrawerAccountId;
	} else {
		cashAccountId = settings.defaultBankAccountId;
	}
	if (!cashAccountId) throw new FinanceError('No account is set up to receive this collection.');

	const newOutstanding = r.outstandingCentavos - input.amountCentavos;
	const status: Receivable['status'] = newOutstanding === 0 ? 'settled' : 'partial';

	await db.transaction(async (tx: Tx) => {
		await recordCashMovement(
			{
				hotelId: input.hotelId,
				businessDate,
				direction: 'in',
				category: r.bookingId ? 'room_revenue' : r.hallBookingId ? 'hall_revenue' : 'other_revenue',
				cashAccountId: cashAccountId!,
				amountCentavos: input.amountCentavos,
				counterpartyType: 'guest',
				counterpartyName: r.billToCompany || r.billToName,
				sourceType: 'receivable_settlement',
				sourceId: r.id,
				shiftId,
				memo: `City ledger collection — ${r.billToCompany || r.billToName}`,
				actor: input.actor
			},
			tx
		);
		await tx
			.update(receivables)
			.set({
				outstandingCentavos: newOutstanding,
				status,
				settledAt: status === 'settled' ? new Date() : null,
				updatedAt: new Date()
			})
			.where(eq(receivables.id, r.id));
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'finance.settle_receivable',
		entityType: 'receivable',
		entityId: r.id,
		after: {
			method: input.method,
			amountCentavos: input.amountCentavos,
			outstandingCentavos: newOutstanding
		}
	});

	return { outstandingCentavos: newOutstanding, status };
}

export async function writeOffReceivable(
	hotelId: string,
	receivableId: string,
	reason: string,
	actor: SessionUser | null
): Promise<void> {
	const [r] = await db
		.select()
		.from(receivables)
		.where(and(eq(receivables.id, receivableId), eq(receivables.hotelId, hotelId)))
		.limit(1);
	if (!r) throw new FinanceError('Receivable not found.');
	if (r.status === 'settled' || r.status === 'written_off')
		throw new FinanceError('This receivable is already closed.');
	if (!reason.trim()) throw new FinanceError('A write-off needs a reason.');

	await db
		.update(receivables)
		.set({
			status: 'written_off',
			outstandingCentavos: 0,
			writtenOffByUserId: actor?.id ?? null,
			writeOffReason: reason.trim(),
			updatedAt: new Date()
		})
		.where(eq(receivables.id, receivableId));

	await writeAudit({
		hotelId,
		actor,
		action: 'finance.write_off_receivable',
		entityType: 'receivable',
		entityId: receivableId,
		before: { outstandingCentavos: r.outstandingCentavos },
		after: { reason: reason.trim() }
	});
}

export async function listReceivables(
	hotelId: string,
	opts: { status?: Receivable['status'] | 'active' } = {}
) {
	const conds = [eq(receivables.hotelId, hotelId)];
	if (opts.status === 'active') conds.push(sql`${receivables.status} in ('open','partial')`);
	else if (opts.status) conds.push(eq(receivables.status, opts.status));

	return db
		.select()
		.from(receivables)
		.where(and(...conds))
		.orderBy(desc(receivables.openedAt));
}

// ---------------------------------------------------------------------------
// Statement of Account — a non-accountable billing document for one receivable
// ---------------------------------------------------------------------------

export interface StatementLine {
	description: string;
	quantity: number;
	totalCentavos: number;
}
export interface StatementPayment {
	date: string;
	amountCentavos: number;
	memo: string | null;
}
export interface StatementOfAccount {
	hotel: {
		name: string;
		legalName: string | null;
		address: string | null;
		tin: string | null;
		isVatRegistered: boolean;
		footerNote: string | null;
	};
	receivable: {
		id: string;
		billToName: string;
		billToCompany: string | null;
		referenceNo: string | null;
		notes: string | null;
		status: Receivable['status'];
		openedOn: string; // ISO date
		originalCentavos: number;
		outstandingCentavos: number;
	};
	lines: StatementLine[];
	/** Sum of the (non-voided) folio charge lines above. */
	chargesTotalCentavos: number;
	/** Charges already settled at or before check-out, before the balance was
	 *  carried to this account (`chargesTotal − originalAmount`). */
	preSettledCentavos: number;
	/** Real collections against the receivable (not the house_use squaring). */
	payments: StatementPayment[];
	paymentsTotalCentavos: number;
	daysOutstanding: number;
	statementDate: string; // ISO date
	remittance: { accountName: string; institution: string | null; accountRef: string | null } | null;
}

/**
 * Assembles a Statement of Account for one city-ledger receivable — the
 * follow-up billing document sent to the company. Regenerable any time; it
 * reflects the current outstanding balance and age. Charge lines come from the
 * underlying folio; "payments received" are the real `settleReceivable`
 * collections, never the `house_use` entry that squared the folio at checkout.
 */
export async function getStatementOfAccount(
	hotelId: string,
	receivableId: string
): Promise<StatementOfAccount | null> {
	const [r] = await db
		.select()
		.from(receivables)
		.where(and(eq(receivables.id, receivableId), eq(receivables.hotelId, hotelId)))
		.limit(1);
	if (!r) return null;

	const [hotel] = await db
		.select({
			name: hotels.name,
			legalName: hotels.legalName,
			addressLine: hotels.addressLine,
			city: hotels.city,
			timezone: hotels.timezone
		})
		.from(hotels)
		.where(eq(hotels.id, hotelId))
		.limit(1);
	if (!hotel) return null;

	const [bir, settings] = await Promise.all([getBirSettings(hotelId), getFinanceSettings(hotelId)]);

	const target: FolioTarget | null = r.bookingId
		? { kind: 'room', bookingId: r.bookingId }
		: r.hallBookingId
			? { kind: 'hall', hallBookingId: r.hallBookingId }
			: null;

	let lines: StatementLine[] = [];
	if (target) {
		try {
			const folio = await getFolioDetail(hotelId, target);
			lines = folio.charges
				.filter((c) => !c.voidedAt)
				.map((c) => ({
					description: c.description,
					quantity: c.quantity,
					totalCentavos: c.totalCentavos
				}));
		} catch {
			lines = [];
		}
	}
	// Fall back to a single lump-sum line if the folio yielded nothing.
	if (lines.length === 0) {
		lines = [
			{
				description: 'Outstanding balance carried to city ledger',
				quantity: 1,
				totalCentavos: r.originalAmountCentavos
			}
		];
	}
	const chargesTotalCentavos = lines.reduce((sum, l) => sum + l.totalCentavos, 0);
	// Part of the folio was already paid before the balance moved to this account.
	const preSettledCentavos = Math.max(0, chargesTotalCentavos - r.originalAmountCentavos);

	const collectionRows = await db
		.select({
			businessDate: cashMovements.businessDate,
			amountCentavos: cashMovements.amountCentavos,
			memo: cashMovements.memo
		})
		.from(cashMovements)
		.where(
			and(
				eq(cashMovements.hotelId, hotelId),
				eq(cashMovements.sourceType, 'receivable_settlement'),
				eq(cashMovements.sourceId, r.id),
				isNull(cashMovements.voidedAt)
			)
		)
		.orderBy(asc(cashMovements.businessDate));
	const statementPayments: StatementPayment[] = collectionRows.map((c) => ({
		date: c.businessDate,
		amountCentavos: c.amountCentavos,
		memo: c.memo
	}));
	const paymentsTotalCentavos = statementPayments.reduce((s, p) => s + p.amountCentavos, 0);

	const statementDate = businessDateFor(hotel.timezone);
	const openedOn = new Date(r.openedAt).toISOString().slice(0, 10);
	const daysOutstanding = Math.max(
		0,
		Math.floor(
			(new Date(`${statementDate}T00:00:00Z`).getTime() - new Date(`${openedOn}T00:00:00Z`).getTime()) /
				86_400_000
		)
	);

	let remittance: StatementOfAccount['remittance'] = null;
	if (settings.defaultBankAccountId) {
		const [bank] = await db
			.select({
				name: cashAccounts.name,
				institution: cashAccounts.institution,
				accountRef: cashAccounts.accountRef
			})
			.from(cashAccounts)
			.where(eq(cashAccounts.id, settings.defaultBankAccountId))
			.limit(1);
		if (bank)
			remittance = {
				accountName: bank.name,
				institution: bank.institution,
				accountRef: bank.accountRef
			};
	}

	return {
		hotel: {
			name: hotel.name,
			legalName: hotel.legalName,
			address:
				bir?.registeredAddress || [hotel.addressLine, hotel.city].filter(Boolean).join(', ') || null,
			tin: bir?.tin ?? null,
			isVatRegistered: bir?.isVatRegistered ?? false,
			footerNote: bir?.footerNote ?? null
		},
		receivable: {
			id: r.id,
			billToName: r.billToName,
			billToCompany: r.billToCompany,
			referenceNo: r.referenceNo,
			notes: r.notes,
			status: r.status,
			openedOn,
			originalCentavos: r.originalAmountCentavos,
			outstandingCentavos: r.outstandingCentavos
		},
		lines,
		chargesTotalCentavos,
		preSettledCentavos,
		payments: statementPayments,
		paymentsTotalCentavos,
		daysOutstanding,
		statementDate,
		remittance
	};
}

export interface ArAgingBucket {
	label: string;
	count: number;
	amountCentavos: number;
}

/** Outstanding receivables bucketed by age from `openedAt`. */
export async function arAging(
	hotelId: string,
	asOf: string
): Promise<{ buckets: ArAgingBucket[]; totalCentavos: number }> {
	const rows = await listReceivables(hotelId, { status: 'active' });
	const asOfMs = new Date(`${asOf}T23:59:59Z`).getTime();
	const defs: [string, number, number][] = [
		['0–30 days', 0, 30],
		['31–60 days', 31, 60],
		['61–90 days', 61, 90],
		['Over 90 days', 91, Infinity]
	];
	const buckets: ArAgingBucket[] = defs.map(([label]) => ({ label, count: 0, amountCentavos: 0 }));
	let total = 0;
	for (const r of rows) {
		const ageDays = Math.floor((asOfMs - new Date(r.openedAt).getTime()) / 86_400_000);
		const idx = defs.findIndex(([, lo, hi]) => ageDays >= lo && ageDays <= hi);
		const b = buckets[idx === -1 ? buckets.length - 1 : idx]!;
		b.count += 1;
		b.amountCentavos += r.outstandingCentavos;
		total += r.outstandingCentavos;
	}
	return { buckets, totalCentavos: total };
}
