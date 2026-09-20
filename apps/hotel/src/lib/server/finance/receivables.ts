import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index';
import {
	bookingRooms,
	bookings,
	cashAccounts,
	cashMovements,
	functionHalls,
	hallBookings,
	hotels,
	payments,
	receivableEntries,
	receivables,
	roomAssignments,
	roomTypes,
	rooms,
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
	/** Required only when this booking has no active city-ledger account yet; otherwise the room
	 *  is added to the existing account and its bill-to is kept. */
	billToName?: string;
	billToCompany?: string | null;
	referenceNo?: string | null;
	notes?: string | null;
	/** How much of THIS room's bill to move; defaults to everything it still owes. */
	amountCentavos?: number;
	actor: SessionUser | null;
}): Promise<{ receivableId: string; amountCentavos: number; addedToExisting: boolean }> {
	// The room's own balance (charges minus what THIS room has been paid) — never the booking's.
	const folio = await getFolioDetail(input.hotelId, input.target);
	if (folio.balanceCentavos <= 0)
		throw new FinanceError('This room has nothing outstanding to move to the city ledger.');
	const amount = input.amountCentavos ?? folio.balanceCentavos;
	if (!Number.isInteger(amount) || amount <= 0)
		throw new FinanceError('Enter an amount greater than zero to move to the city ledger.');
	if (amount > folio.balanceCentavos)
		throw new FinanceError(
			`This room only owes ${pesos(folio.balanceCentavos)} — that is the most that can move to the city ledger.`
		);

	const orderId = await getOrderIdForTarget(input.target);
	if (!orderId) throw new FinanceError('Booking not found.');

	const { receivableId, addedToExisting } = await db.transaction(async (tx: Tx) => {
		const folioId = await ensureFolio(tx, input.hotelId, input.target);

		// One ledger ACCOUNT per booking: another room joins the booking's active account
		// (open / partial) as a new entry instead of opening a second account.
		const [existing] = await tx
			.select({ id: receivables.id })
			.from(receivables)
			.where(
				and(
					eq(receivables.hotelId, input.hotelId),
					eq(receivables.orderId, orderId),
					sql`${receivables.status} in ('open','partial')`
				)
			)
			.orderBy(asc(receivables.openedAt))
			.limit(1)
			.for('update');
		if (!existing && !input.billToName?.trim())
			throw new FinanceError('Enter who the balance is billed to.');

		// Square the room so its check-out balance gate passes — this isn't cash, so no
		// cash_movements row; the debt is now carried by the ledger account.
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

		let id: string;
		if (existing) {
			id = existing.id;
			await tx
				.update(receivables)
				.set({
					originalAmountCentavos: sql`${receivables.originalAmountCentavos} + ${amount}`,
					outstandingCentavos: sql`${receivables.outstandingCentavos} + ${amount}`,
					updatedAt: new Date()
				})
				.where(eq(receivables.id, id));
		} else {
			const [row] = await tx
				.insert(receivables)
				.values({
					hotelId: input.hotelId,
					orderId,
					folioId,
					bookingId: input.target.kind === 'room' ? input.target.bookingId : null,
					hallBookingId: input.target.kind === 'hall' ? input.target.hallBookingId : null,
					billToName: input.billToName!.trim(),
					billToCompany: input.billToCompany?.trim() || null,
					referenceNo: input.referenceNo?.trim() || null,
					originalAmountCentavos: amount,
					outstandingCentavos: amount,
					openedByUserId: input.actor?.id ?? null,
					notes: input.notes?.trim() || null
				})
				.returning({ id: receivables.id });
			id = row!.id;
		}

		await tx.insert(receivableEntries).values({
			receivableId: id,
			bookingId: input.target.kind === 'room' ? input.target.bookingId : null,
			hallBookingId: input.target.kind === 'hall' ? input.target.hallBookingId : null,
			folioId,
			amountCentavos: amount,
			notes: input.notes?.trim() || null,
			openedByUserId: input.actor?.id ?? null
		});
		return { receivableId: id, addedToExisting: !!existing };
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: addedToExisting ? 'finance.add_receivable_entry' : 'finance.open_receivable',
		entityType: 'receivable',
		entityId: receivableId,
		after: { amountCentavos: amount, billToName: input.billToName ?? null }
	});

	return { receivableId, amountCentavos: amount, addedToExisting };
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

/**
 * Undoes a write-off: the account goes back to `open` / `partial` / `settled`
 * with its outstanding balance recomputed from the original amount minus every
 * real collection recorded against it. A write-off posts no cash, so there is
 * nothing to reverse in the ledger — this is a pure status restore.
 */
export async function reopenReceivable(
	hotelId: string,
	receivableId: string,
	actor: SessionUser | null
): Promise<{ status: Receivable['status']; outstandingCentavos: number }> {
	const [r] = await db
		.select()
		.from(receivables)
		.where(and(eq(receivables.id, receivableId), eq(receivables.hotelId, hotelId)))
		.limit(1);
	if (!r) throw new FinanceError('Receivable not found.');
	if (r.status !== 'written_off')
		throw new FinanceError('Only a written-off account can be reopened.');

	const [collected] = await db
		.select({ total: sql<number>`coalesce(sum(${cashMovements.amountCentavos}), 0)::bigint` })
		.from(cashMovements)
		.where(
			and(
				eq(cashMovements.hotelId, hotelId),
				eq(cashMovements.sourceType, 'receivable_settlement'),
				eq(cashMovements.sourceId, receivableId),
				isNull(cashMovements.voidedAt)
			)
		);
	const paid = Number(collected?.total ?? 0);
	const outstanding = Math.max(0, r.originalAmountCentavos - paid);
	const status: Receivable['status'] =
		outstanding <= 0 ? 'settled' : paid > 0 ? 'partial' : 'open';

	await db
		.update(receivables)
		.set({
			status,
			outstandingCentavos: outstanding,
			writtenOffByUserId: null,
			writeOffReason: null,
			settledAt: status === 'settled' ? (r.settledAt ?? new Date()) : null,
			updatedAt: new Date()
		})
		.where(eq(receivables.id, receivableId));

	await writeAudit({
		hotelId,
		actor,
		action: 'finance.reopen_receivable',
		entityType: 'receivable',
		entityId: receivableId,
		before: { status: 'written_off', reason: r.writeOffReason },
		after: { status, outstandingCentavos: outstanding }
	});
	return { status, outstandingCentavos: outstanding };
}

export async function listReceivables(
	hotelId: string,
	opts: { status?: Receivable['status'] | 'active' } = {}
) {
	const conds = [eq(receivables.hotelId, hotelId)];
	if (opts.status === 'active') conds.push(sql`${receivables.status} in ('open','partial')`);
	else if (opts.status) conds.push(eq(receivables.status, opts.status));

	const rows = await db
		.select()
		.from(receivables)
		.where(and(...conds))
		.orderBy(desc(receivables.openedAt));

	// Cross-reference: the booking (order) and the room(s) each ledger account covers.
	const entryRows = rows.length
		? await db
				.select({
						receivableId: receivableEntries.receivableId,
						bookingId: receivableEntries.bookingId,
						hallBookingId: receivableEntries.hallBookingId
					})
				.from(receivableEntries)
				.where(inArray(receivableEntries.receivableId, rows.map((r) => r.id)))
		: [];
	const roomIds = [...new Set(entryRows.map((e) => e.bookingId).filter((v): v is string => !!v))];
	const hallIds = [...new Set(entryRows.map((e) => e.hallBookingId).filter((v): v is string => !!v))];
	const labelOf = new Map<string, string>();
	if (roomIds.length > 0) {
		const bk = await db
			.select({ id: bookings.id, typeName: roomTypes.name, bookingRoomId: bookingRooms.id })
			.from(bookings)
			.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
			.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
			.where(inArray(bookings.id, roomIds));
		const nums = await db
			.select({ bookingRoomId: roomAssignments.bookingRoomId, roomNumber: rooms.roomNumber })
			.from(roomAssignments)
			.innerJoin(rooms, eq(rooms.id, roomAssignments.roomId))
			.where(inArray(roomAssignments.bookingRoomId, bk.map((b) => b.bookingRoomId)));
		for (const b of bk) {
			const n = nums.filter((x) => x.bookingRoomId === b.bookingRoomId).map((x) => x.roomNumber);
			labelOf.set(b.id, n.length ? `Room ${n.join(', ')}` : b.typeName);
		}
	}
	if (hallIds.length > 0) {
		const hb = await db
			.select({ id: hallBookings.id, name: functionHalls.name })
			.from(hallBookings)
			.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
			.where(inArray(hallBookings.id, hallIds));
		for (const h of hb) labelOf.set(h.id, h.name);
	}
	return rows.map((r) => {
		const labels = entryRows
			.filter((e) => e.receivableId === r.id)
			.map((e) => labelOf.get((e.bookingId ?? e.hallBookingId) ?? ''))
			.filter((v): v is string => !!v);
		return {
			...r,
			/** The booking's short code — the same one shown on the Transaction page and confirmation. */
			orderCode: r.orderId ? r.orderId.slice(0, 8).toUpperCase() : null,
			/** Every room/hall on this account, e.g. "Room D1, Room 101". */
			roomLabel: labels.length ? labels.join(', ') : null,
			entryCount: labels.length
		};
	});
}

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

	// One block of folio lines per room on the account (a legacy account without entries falls back
	// to its single booking). With several rooms each line is prefixed with the room.
	const entryList = await db
		.select()
		.from(receivableEntries)
		.where(eq(receivableEntries.receivableId, r.id))
		.orderBy(asc(receivableEntries.createdAt));
	const targets: FolioTarget[] = entryList.length
		? entryList.flatMap((e): FolioTarget[] =>
				e.bookingId
					? [{ kind: 'room', bookingId: e.bookingId }]
					: e.hallBookingId
						? [{ kind: 'hall', hallBookingId: e.hallBookingId }]
						: []
			)
		: r.bookingId
			? [{ kind: 'room', bookingId: r.bookingId }]
			: r.hallBookingId
				? [{ kind: 'hall', hallBookingId: r.hallBookingId }]
				: [];

	let lines: StatementLine[] = [];
	for (const [i, target] of targets.entries()) {
		try {
			const folio = await getFolioDetail(hotelId, target);
			const prefix = targets.length > 1 ? `Room/event ${i + 1} — ` : '';
			lines.push(
				...folio.charges
					.filter((c) => !c.voidedAt)
					.map((c) => ({
						description: prefix + c.description,
						quantity: c.quantity,
						totalCentavos: c.totalCentavos
					}))
			);
		} catch {
			// a folio that cannot be read just contributes no lines
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
