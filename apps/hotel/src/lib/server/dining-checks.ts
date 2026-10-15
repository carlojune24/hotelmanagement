import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from './db/index';
import {
	diningItems,
	diningOrderItems,
	diningOrders,
	diningReservations,
	diningReservationTables,
	diningTableChecks,
	diningTables,
	hotels,
	type DiningOrder
} from './db/schema/index';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';
import type { PaymentMethod } from './finance/payments';
import { chargeDiningOrderToRoom } from './dining-room-charge';
import { OrderError, cancelDiningOrder, payDiningOrder } from './dining-orders';
import { loadHolds } from './dining-reservations';
import { HOLDING_STATUSES, localParts, zonedToUtc } from '../dining-slots';
import { checkStage, summarizeCheck, type CheckOrderLite, type CheckSummary } from '../dining-checks';
import { groupByStation, type StationState } from '../dining-orders';
import type { BillTo, IssuedDocument, PayDocuments } from '../print-batch';

type Actor = SessionUser | null;

export interface OpenCheck extends CheckSummary {
	id: string;
	tableId: string;
	tableName: string;
	venueId: string;
	reservationId: string | null;
	openedAt: Date;
	billRequestedAt: Date | null;
	orders: (CheckOrderLite & {
		id: string;
		code: string;
		source: string;
		/** Where each station is with this order, for the table panel on the Floor. */
		stations: { label: string; state: StationState }[];
	})[];
}

/** Every open check, with its orders and a summary of where the table stands. */
export async function listOpenChecks(hotelId: string, venueId?: string | null): Promise<OpenCheck[]> {
	const checks = await db
		.select({
			id: diningTableChecks.id,
			tableId: diningTableChecks.tableId,
			tableName: diningTables.name,
			venueId: diningTableChecks.diningItemId,
			reservationId: diningTableChecks.reservationId,
			openedAt: diningTableChecks.openedAt,
			billRequestedAt: diningTableChecks.billRequestedAt
		})
		.from(diningTableChecks)
		.innerJoin(diningTables, eq(diningTables.id, diningTableChecks.tableId))
		.where(
			and(
				eq(diningTableChecks.hotelId, hotelId),
				eq(diningTableChecks.status, 'open'),
				venueId ? eq(diningTableChecks.diningItemId, venueId) : undefined
			)
		)
		.orderBy(asc(diningTableChecks.openedAt));
	if (checks.length === 0) return [];

	const orders = await db
		.select({
			id: diningOrders.id,
			checkId: diningOrders.checkId,
			code: diningOrders.code,
			source: diningOrders.source,
			status: diningOrders.status,
			paymentStatus: diningOrders.paymentStatus,
			totalCentavos: diningOrders.totalCentavos
		})
		.from(diningOrders)
		.where(inArray(diningOrders.checkId, checks.map((c) => c.id)))
		.orderBy(asc(diningOrders.createdAt));

	const lines = await db
		.select({
			orderId: diningOrderItems.orderId,
			stationName: diningOrderItems.stationName,
			startedAt: diningOrderItems.startedAt,
			readyAt: diningOrderItems.readyAt
		})
		.from(diningOrderItems)
		.where(inArray(diningOrderItems.orderId, orders.map((o) => o.id)));

	return checks.map((c) => {
		const mine = orders
			.filter((o) => o.checkId === c.id)
			.map((o) => ({
				...o,
				stations: groupByStation(lines.filter((l) => l.orderId === o.id)).map((g) => ({ label: g.label, state: g.state }))
			}));
		return {
			...c,
			orders: mine,
			...summarizeCheck(mine, !!c.billRequestedAt)
		};
	});
}

async function loadCheck(hotelId: string, checkId: string) {
	const [check] = await db
		.select()
		.from(diningTableChecks)
		.where(and(eq(diningTableChecks.id, checkId), eq(diningTableChecks.hotelId, hotelId)))
		.limit(1);
	if (!check) throw new OrderError('That table check could not be found.');
	if (check.status !== 'open') throw new OrderError('That table is already closed.');
	return check;
}

async function ordersOf(checkId: string): Promise<DiningOrder[]> {
	return db.select().from(diningOrders).where(eq(diningOrders.checkId, checkId)).orderBy(asc(diningOrders.createdAt));
}

export type SettleMethod = PaymentMethod | 'room';

/**
 * Pays every unpaid order on the table's check with one method, then closes the check if the
 * table is also fully served. Each order keeps its own payment, ledger entry and receipt (the
 * existing per-order rules still apply), so a failure part-way leaves the paid ones paid and
 * can simply be run again for the rest.
 *
 * `cash` needs `tenderedCentavos` covering the whole unpaid amount; the change is returned.
 * `room` charges every order to the in-house guest's folio.
 */
export async function settleCheck(args: {
	hotelId: string;
	checkId: string;
	method: SettleMethod;
	tenderedCentavos?: number | null;
	bookingId?: string | null;
	/** What to issue for each order paid; see `payDiningOrder`. A room charge issues nothing. */
	documents?: PayDocuments;
	billTo?: BillTo;
	actor?: Actor;
}): Promise<{
	paidCount: number;
	totalCentavos: number;
	changeCentavos: number;
	closed: boolean;
	/** One per order paid, in order, ready to print together. */
	documents: IssuedDocument[];
	documentError: string | null;
}> {
	const check = await loadCheck(args.hotelId, args.checkId);
	const orders = await ordersOf(check.id);
	if (orders.some((o) => o.status === 'pending_acceptance')) {
		throw new OrderError('An order on this table is still waiting to be accepted. Accept or decline it first.');
	}
	const unpaid = orders.filter((o) => o.status !== 'cancelled' && o.paymentStatus === 'unpaid');
	const owed = unpaid.reduce((s, o) => s + o.totalCentavos, 0);

	if (unpaid.length > 0) {
		if (args.method === 'cash' && (!Number.isInteger(args.tenderedCentavos) || (args.tenderedCentavos ?? 0) < owed)) {
			throw new OrderError('Cash tendered must cover the whole table.');
		}
		if (args.method === 'room' && !args.bookingId) throw new OrderError('Pick the guest whose room to charge.');
	}

	let paidCount = 0;
	const documents: IssuedDocument[] = [];
	const documentErrors: string[] = [];
	for (const o of unpaid) {
		if (args.method === 'room') {
			await chargeDiningOrderToRoom({ hotelId: args.hotelId, orderId: o.id, bookingId: args.bookingId!, actor: args.actor ?? null });
		} else {
			const paid = await payDiningOrder({
				hotelId: args.hotelId,
				orderId: o.id,
				method: args.method,
				// The change is worked out for the table as a whole; each order is tendered exactly.
				tenderedCentavos: args.method === 'cash' ? o.totalCentavos : null,
				documents: args.documents,
				billTo: args.billTo,
				actor: args.actor ?? null
			});
			documents.push(...paid.documents);
			if (paid.documentError) documentErrors.push(paid.documentError);
		}
		paidCount++;
	}

	const changeCentavos = args.method === 'cash' ? Math.max(0, (args.tenderedCentavos ?? 0) - owed) : 0;
	if (paidCount > 0) {
		await writeAudit({
			hotelId: args.hotelId,
			actor: args.actor ?? null,
			action: 'dining_check.settle',
			entityType: 'dining_table_check',
			entityId: check.id,
			after: {
				checkId: check.id,
				method: args.method,
				paidCount,
				orderCodes: unpaid.map((o) => o.code),
				totalCentavos: owed,
				tenderedCentavos: args.method === 'cash' ? (args.tenderedCentavos ?? null) : null,
				changeCentavos,
				bookingId: args.method === 'room' ? (args.bookingId ?? null) : null,
				documents: documents.map((d) => d.formattedNo),
				documentError: documentErrors[0] ?? null
			}
		});
	}
	const closed = await closeIfDone(args.hotelId, check.id, args.actor ?? null);
	// The same reason usually repeats for every order (no series), so say it once.
	return { paidCount, totalCentavos: owed, changeCentavos, closed, documents, documentError: documentErrors[0] ?? null };
}

/** Closes the check when nothing is left to serve or pay. Returns whether it closed. */
async function closeIfDone(hotelId: string, checkId: string, actor: Actor): Promise<boolean> {
	const stage = checkStage(summarizeCheck(await ordersOf(checkId), false));
	if (stage !== 'ready_to_clear') return false;
	await closeCheck({ hotelId, checkId, actor });
	return true;
}

/**
 * Frees the table: every order must be served (or cancelled) and paid. A seated reservation on
 * the table is completed with it.
 */
export async function closeCheck(args: { hotelId: string; checkId: string; actor?: Actor }): Promise<void> {
	const check = await loadCheck(args.hotelId, args.checkId);
	const orders = await ordersOf(check.id);
	const live = orders.filter((o) => o.status !== 'cancelled');
	if (live.some((o) => o.status === 'pending_acceptance')) {
		throw new OrderError('An order on this table is still waiting to be accepted.');
	}
	if (live.some((o) => o.status !== 'served')) throw new OrderError('Some orders on this table have not been served yet.');
	if (live.some((o) => o.paymentStatus === 'unpaid')) throw new OrderError('This table still has unpaid orders. Settle the bill first.');
	await finish(args.hotelId, check, args.actor ?? null, 'dining_check.close', {});
}

async function finish(
	hotelId: string,
	check: typeof diningTableChecks.$inferSelect,
	actor: Actor,
	action: string,
	extra: Record<string, unknown>
) {
	const now = new Date();
	await db.transaction(async (tx) => {
		await tx
			.update(diningTableChecks)
			.set({
				status: 'closed',
				closedAt: now,
				closedByUserId: actor?.id ?? null,
				forceClearedAt: action === 'dining_check.force_clear' ? now : null,
				updatedAt: now
			})
			.where(and(eq(diningTableChecks.id, check.id), eq(diningTableChecks.status, 'open')));
		if (check.reservationId) {
			await tx
				.update(diningReservations)
				.set({ status: 'completed', updatedAt: now })
				.where(and(eq(diningReservations.id, check.reservationId), eq(diningReservations.status, 'seated')));
		}
		const [res] = check.reservationId
			? await tx.select({ code: diningReservations.code }).from(diningReservations).where(eq(diningReservations.id, check.reservationId)).limit(1)
			: [];
		await writeAudit({
			tx,
			hotelId,
			actor,
			action,
			entityType: 'dining_table_check',
			entityId: check.id,
			refCode: res?.code ?? null,
			after: { checkId: check.id, tableId: check.tableId, reservationId: check.reservationId, ...extra }
		});
	});
}

/**
 * A manager clears a table that cannot be settled normally (the guests walked out, a stuck
 * order). Unserved orders that were never paid are cancelled with the reason; unserved paid ones
 * are marked served. Anything served but unpaid stays on the Orders board for the cashier.
 */
export async function forceClearCheck(args: { hotelId: string; checkId: string; reason: string; actor?: Actor }): Promise<void> {
	const reason = args.reason.trim();
	if (!reason) throw new OrderError('Give a reason for clearing the table.');
	const check = await loadCheck(args.hotelId, args.checkId);
	const orders = await ordersOf(check.id);
	const now = new Date();
	for (const o of orders) {
		if (o.status === 'served' || o.status === 'cancelled') continue;
		if (o.paymentStatus === 'unpaid') {
			await cancelDiningOrder({ hotelId: args.hotelId, orderId: o.id, reason: `Table cleared: ${reason}`, actor: args.actor ?? null });
		} else {
			await db.transaction(async (tx) => {
				await tx.update(diningOrders).set({ status: 'served', servedAt: now, updatedAt: now }).where(eq(diningOrders.id, o.id));
				await writeAudit({
					tx,
					hotelId: args.hotelId,
					actor: args.actor ?? null,
					action: 'dining_order.force_served',
					entityType: 'dining_order',
					entityId: o.id,
					refCode: o.code,
					before: { status: o.status },
					after: { orderId: o.id, checkId: check.id, status: 'served', reason }
				});
			});
		}
	}
	await finish(args.hotelId, check, args.actor ?? null, 'dining_check.force_clear', { reason });
}

/** The guest (or a waiter) asked for the bill; the floor plan turns the table to "Needs payment". */
export async function requestBill(args: { hotelId: string; checkId: string; actor?: Actor }): Promise<void> {
	const check = await loadCheck(args.hotelId, args.checkId);
	if (check.billRequestedAt) return;
	await db
		.update(diningTableChecks)
		.set({ billRequestedAt: new Date(), updatedAt: new Date() })
		.where(eq(diningTableChecks.id, check.id));
	await writeAudit({
		hotelId: args.hotelId,
		actor: args.actor ?? null,
		action: 'dining_check.bill_requested',
		entityType: 'dining_table_check',
		entityId: check.id
	});
}

/** The open check for one table, if any (used by the guest QR page and table deletion). */
export async function getOpenCheckForTable(hotelId: string, tableId: string) {
	const [c] = await db
		.select()
		.from(diningTableChecks)
		.where(and(eq(diningTableChecks.hotelId, hotelId), eq(diningTableChecks.tableId, tableId), eq(diningTableChecks.status, 'open')))
		.orderBy(desc(diningTableChecks.openedAt))
		.limit(1);
	return c ?? null;
}

/**
 * Guests change tables: the table's whole tab goes with them. The check is repointed at the new
 * table (so the check id, payments, bill request and messages are untouched) and every order on
 * it, plus QR orders still waiting for a waiter at the old table, follows: `tableId` and the
 * `tableLabel` snapshot the Orders board, Kitchen and alerts read. A seated reservation moves
 * with them so the old table does not keep reading "Seated".
 *
 * The destination must be empty: no open check, no QR order waiting on it, no seated guests and
 * no booking inside the venue's turn time. To fold the tab into one that is already open, use
 * `mergeCheckIntoCheck`.
 */
export async function moveCheckToTable(args: {
	hotelId: string;
	checkId: string;
	toTableId: string;
	actor?: Actor;
}): Promise<{ fromName: string; toName: string; orderCount: number }> {
	const actor = args.actor ?? null;
	try {
		return await db.transaction(async (tx) => {
			const [check] = await tx
				.select()
				.from(diningTableChecks)
				.where(and(eq(diningTableChecks.id, args.checkId), eq(diningTableChecks.hotelId, args.hotelId)))
				.for('update');
			if (!check) throw new OrderError('That table check could not be found.');
			if (check.status !== 'open') throw new OrderError('That table is already closed.');
			if (check.tableId === args.toTableId) throw new OrderError('The guests are already at that table.');

			const [dest] = await tx
				.select({ id: diningTables.id, name: diningTables.name })
				.from(diningTables)
				.where(
					and(
						eq(diningTables.id, args.toTableId),
						eq(diningTables.hotelId, args.hotelId),
						eq(diningTables.diningItemId, check.diningItemId),
						eq(diningTables.isActive, true)
					)
				)
				.limit(1);
			if (!dest) throw new OrderError('Pick a table from this venue.');
			const [source] = await tx
				.select({ name: diningTables.name })
				.from(diningTables)
				.where(eq(diningTables.id, check.tableId))
				.limit(1);

			// Same lock reservations take, so a booking cannot land on the table mid-move.
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtext(${args.hotelId}), hashtext(${'dining:' + check.diningItemId}))`
			);

			const [occupied] = await tx
				.select({ id: diningTableChecks.id })
				.from(diningTableChecks)
				.where(and(eq(diningTableChecks.tableId, dest.id), eq(diningTableChecks.status, 'open')))
				.limit(1);
			if (occupied) throw new OrderError(`Table ${dest.name} already has guests.`);

			const [waiting] = await tx
				.select({ id: diningOrders.id })
				.from(diningOrders)
				.where(
					and(
						eq(diningOrders.hotelId, args.hotelId),
						eq(diningOrders.tableId, dest.id),
						eq(diningOrders.status, 'pending_acceptance')
					)
				)
				.limit(1);
			if (waiting) {
				throw new OrderError(`Table ${dest.name} has an order waiting to be accepted. Accept or decline it first.`);
			}

			const [own] = check.reservationId
				? await tx
						.select({
							status: diningReservations.status,
							startsAt: diningReservations.startsAt,
							endsAt: diningReservations.endsAt
						})
						.from(diningReservations)
						.where(eq(diningReservations.id, check.reservationId))
						.limit(1)
				: [];
			const ownHolds = !!own && (HOLDING_STATUSES as readonly string[]).includes(own.status);
			const ignore = ownHolds ? check.reservationId : null;

			// Guests seated there count however long they have overstayed, but only today's: the
			// Floor reads a reservation from an earlier day that was never completed as nothing at all,
			// so a table that shows Free must not be refused here.
			const [hotel] = await tx.select({ timezone: hotels.timezone }).from(hotels).where(eq(hotels.id, args.hotelId)).limit(1);
			const timezone = hotel?.timezone ?? 'Asia/Manila';
			const todayStart = zonedToUtc(localParts(new Date(), timezone).date, '00:00', timezone);
			const [seatedThere] = await tx
				.select({ id: diningReservations.id })
				.from(diningReservations)
				.innerJoin(diningReservationTables, eq(diningReservationTables.reservationId, diningReservations.id))
				.where(
					and(
						eq(diningReservationTables.tableId, dest.id),
						eq(diningReservations.hotelId, args.hotelId),
						eq(diningReservations.status, 'seated'),
						gt(diningReservations.endsAt, todayStart),
						ignore ? ne(diningReservations.id, ignore) : undefined
					)
				)
				.limit(1);
			if (seatedThere) throw new OrderError(`Table ${dest.name} has seated guests.`);

			const [venue] = await tx
				.select({ turnMinutes: diningItems.turnMinutes })
				.from(diningItems)
				.where(eq(diningItems.id, check.diningItemId))
				.limit(1);
			const now = new Date();
			let from = now;
			let to = new Date(now.getTime() + (venue?.turnMinutes ?? 90) * 60_000);
			if (ownHolds && own) {
				if (own.startsAt < from) from = own.startsAt;
				if (own.endsAt > to) to = own.endsAt;
			}
			const clash = (await loadHolds(args.hotelId, check.diningItemId, from, to, tx))
				.filter((h) => h.reservationId !== ignore && h.tableIds.includes(dest.id))
				.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
			if (clash) {
				const at = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(
					clash.startsAt
				);
				throw new OrderError(`Table ${dest.name} is booked at ${at}.`);
			}

			await tx.update(diningTableChecks).set({ tableId: dest.id, updatedAt: now }).where(eq(diningTableChecks.id, check.id));

			// The check's own orders, plus QR orders still waiting at the old table. Never match on the
			// old table alone: that would drag in earlier, closed sessions.
			const moved = await tx
				.update(diningOrders)
				.set({ tableId: dest.id, tableLabel: dest.name, updatedAt: now })
				.where(
					and(
						eq(diningOrders.hotelId, args.hotelId),
						or(
							eq(diningOrders.checkId, check.id),
							and(
								eq(diningOrders.tableId, check.tableId),
								eq(diningOrders.status, 'pending_acceptance'),
								isNull(diningOrders.checkId)
							)
						)
					)
				)
				.returning({ id: diningOrders.id, code: diningOrders.code });

			if (ignore) {
				await tx
					.delete(diningReservationTables)
					.where(and(eq(diningReservationTables.reservationId, ignore), eq(diningReservationTables.tableId, check.tableId)));
				await tx
					.insert(diningReservationTables)
					.values({ reservationId: ignore, tableId: dest.id })
					.onConflictDoNothing();
			}

			await writeAudit({
				tx,
				hotelId: args.hotelId,
				actor,
				action: 'dining_check.move_table',
				entityType: 'dining_table_check',
				entityId: check.id,
				before: { tableId: check.tableId, tableName: source?.name ?? null },
				after: {
					checkId: check.id,
					tableId: dest.id,
					tableName: dest.name,
					orderCount: moved.length,
					orderCodes: moved.map((o) => o.code),
					reservationId: ignore
				}
			});
			// One entry per order too, so each order's own trail shows the table change.
			for (const o of moved) {
				await writeAudit({
					tx,
					hotelId: args.hotelId,
					actor,
					action: 'dining_order.table_moved',
					entityType: 'dining_order',
					entityId: o.id,
					refCode: o.code,
					before: { tableId: check.tableId, tableName: source?.name ?? null },
					after: { orderId: o.id, checkId: check.id, tableId: dest.id, tableName: dest.name }
				});
			}
			return { fromName: source?.name ?? '', toName: dest.name, orderCount: moved.length };
		});
	} catch (e) {
		// Someone opened a tab on the destination between our check and the update.
		const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
		if (code === '23505') throw new OrderError('That table was just taken. Pick another one.');
		throw e;
	}
}

/**
 * A guest who has already ordered goes to sit with a friend: their tab is folded into the friend's
 * open tab. Every order on `fromCheckId` (plus QR orders still waiting at its table) is repointed
 * at the surviving check and its table, then the emptied check is closed, so the first table
 * reads Free and the pair settle together. Payments, receipts and kitchen state hang off the
 * order, so nothing is renumbered or charged twice.
 *
 * The surviving check keeps its own reservation and bill request; it is opened at the earlier of
 * the two. A seated reservation on the folded check is completed, as when a table is cleared.
 * To move onto an *empty* table use `moveCheckToTable`.
 */
export async function mergeCheckIntoCheck(args: {
	hotelId: string;
	fromCheckId: string;
	intoCheckId: string;
	actor?: Actor;
}): Promise<{ fromName: string; toName: string; intoTableId: string; orderCount: number }> {
	const actor = args.actor ?? null;
	if (args.fromCheckId === args.intoCheckId) throw new OrderError('Pick a different table to join.');
	return db.transaction(async (tx) => {
		// Lock in a fixed order so two staff joining the same pair cannot deadlock.
		const locked = await tx
			.select()
			.from(diningTableChecks)
			.where(
				and(
					eq(diningTableChecks.hotelId, args.hotelId),
					inArray(diningTableChecks.id, [args.fromCheckId, args.intoCheckId])
				)
			)
			.orderBy(asc(diningTableChecks.id))
			.for('update');
		const from = locked.find((c) => c.id === args.fromCheckId);
		const into = locked.find((c) => c.id === args.intoCheckId);
		if (!from || !into) throw new OrderError('That table check could not be found.');
		if (from.status !== 'open' || into.status !== 'open') throw new OrderError('That table is already closed.');
		if (from.diningItemId !== into.diningItemId) throw new OrderError('Pick a table from this venue.');

		// Same lock reservations and moves take.
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${args.hotelId}), hashtext(${'dining:' + from.diningItemId}))`
		);

		const names = await tx
			.select({ id: diningTables.id, name: diningTables.name })
			.from(diningTables)
			.where(inArray(diningTables.id, [from.tableId, into.tableId]));
		const fromName = names.find((t) => t.id === from.tableId)?.name ?? '';
		const toName = names.find((t) => t.id === into.tableId)?.name ?? '';

		const now = new Date();
		const atNewTable = { tableId: into.tableId, tableLabel: toName, updatedAt: now };
		const joined = await tx
			.update(diningOrders)
			.set({ ...atNewTable, checkId: into.id })
			.where(and(eq(diningOrders.hotelId, args.hotelId), eq(diningOrders.checkId, from.id)))
			.returning({ id: diningOrders.id, code: diningOrders.code });
		// QR orders still waiting for a waiter follow too, but stay out of any check until accepted.
		// Never match on the table alone: that would drag in earlier, closed sessions.
		const waiting = await tx
			.update(diningOrders)
			.set(atNewTable)
			.where(
				and(
					eq(diningOrders.hotelId, args.hotelId),
					eq(diningOrders.tableId, from.tableId),
					eq(diningOrders.status, 'pending_acceptance'),
					isNull(diningOrders.checkId)
				)
			)
			.returning({ id: diningOrders.id, code: diningOrders.code });
		const moved = [...joined, ...waiting];

		await tx
			.update(diningTableChecks)
			.set({ openedAt: from.openedAt < into.openedAt ? from.openedAt : into.openedAt, updatedAt: now })
			.where(eq(diningTableChecks.id, into.id));
		await tx
			.update(diningTableChecks)
			.set({ status: 'closed', closedAt: now, closedByUserId: actor?.id ?? null, updatedAt: now })
			.where(eq(diningTableChecks.id, from.id));
		if (from.reservationId && from.reservationId !== into.reservationId) {
			await tx
				.update(diningReservations)
				.set({ status: 'completed', updatedAt: now })
				.where(and(eq(diningReservations.id, from.reservationId), eq(diningReservations.status, 'seated')));
		}

		await writeAudit({
			tx,
			hotelId: args.hotelId,
			actor,
			action: 'dining_check.merge',
			entityType: 'dining_table_check',
			entityId: from.id,
			before: { tableId: from.tableId, tableName: fromName },
			after: {
				checkId: from.id,
				intoCheckId: into.id,
				intoTableId: into.tableId,
				intoTableName: toName,
				orderCount: moved.length,
				orderIds: moved.map((o) => o.id),
				orderCodes: moved.map((o) => o.code)
			}
		});
		for (const o of moved) {
			await writeAudit({
				tx,
				hotelId: args.hotelId,
				actor,
				action: 'dining_order.table_moved',
				entityType: 'dining_order',
				entityId: o.id,
				refCode: o.code,
				before: { tableId: from.tableId, tableName: fromName, checkId: from.id },
				after: { orderId: o.id, checkId: into.id, tableId: into.tableId, tableName: toName, merged: true }
			});
		}
		return { fromName, toName, intoTableId: into.tableId, orderCount: moved.length };
	});
}
