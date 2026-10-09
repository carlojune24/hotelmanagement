import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from './db/index';
import {
	diningOrderItems,
	diningOrders,
	diningReservations,
	diningTableChecks,
	diningTables,
	type DiningOrder
} from './db/schema/index';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';
import type { PaymentMethod } from './finance/payments';
import { chargeDiningOrderToRoom } from './dining-room-charge';
import { OrderError, cancelDiningOrder, payDiningOrder } from './dining-orders';
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
		await writeAudit({
			hotelId,
			actor,
			action,
			entityType: 'dining_table_check',
			entityId: check.id,
			after: { tableId: check.tableId, ...extra }
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
			await db.update(diningOrders).set({ status: 'served', servedAt: now, updatedAt: now }).where(eq(diningOrders.id, o.id));
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
