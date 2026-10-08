import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { db } from './db/index';
import {
	cashMovements,
	diningAddonGroups,
	diningAddons,
	diningItems,
	diningMenuItemAddonGroups,
	diningMenuItems,
	diningOrderItemAddons,
	diningOrderItems,
	diningOrders,
	diningReservations,
	diningStations,
	diningTables,
	hotels,
	type DiningOrder,
	type DiningOrderStatus,
	type DiningOrderType
} from './db/schema/index';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';
import { FinanceError, businessDateFor } from './finance/shared';
import { changeFor } from './finance/calc';
import { recordCashMovement, voidCashMovement } from './finance/cash';
import { resolvePaymentAccount, type PaymentMethod } from './finance/payments';
import {
	cancelDiningReceipt,
	getBirSettings,
	issueDiningDocument,
	listDiningOrderDocuments
} from './finance/documents';
import { venueBelongsToHotel } from './dining-menu';
import { sendDiningOrderEmail } from './email/send-dining-order';
import { canMoveOrder, checkAddonSelection, priceLine, sumLines, type AddonGroupRule } from '../dining-orders';

/** A rule or conflict to show the user (an unavailable dish, a missing choice), not a bug. */
export class OrderError extends Error {}

type Actor = SessionUser | null;

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const makeCode = () => 'DN-' + Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

export interface OrderLineInput {
	menuItemId: string;
	quantity: number;
	remarks?: string | null;
	addonIds?: string[];
}

export interface CreateOrderInput {
	hotelId: string;
	venueId: string;
	orderType: DiningOrderType;
	lines: OrderLineInput[];
	tableId?: string | null;
	reservationId?: string | null;
	bookingId?: string | null;
	guestName?: string | null;
	guestPhone?: string | null;
	guestEmail?: string | null;
	remarks?: string | null;
	source?: 'staff' | 'online';
	/** Takeaway pickup time (or the table time of a pre-order). */
	pickupAt?: Date | null;
	/** How an online order is being paid: 'online' (PayMongo) or 'venue' (at pickup). */
	payMode?: 'online' | 'venue' | null;
	/** `pending_payment` for an online order that must be paid before the kitchen sees it. */
	initialStatus?: 'new' | 'pending_payment';
	actor?: Actor;
}

const MAX_LINES = 40;
const MAX_QTY = 50;

/**
 * Creates an order. Every line is re-priced from the live menu (a client-sent price is never
 * trusted), the dish must be on this venue's menu, active and not sold out, and the add-on picks
 * must satisfy each group's rules. Item names, prices and stations are snapshotted so later menu
 * edits never rewrite a past order. Prices are VAT-inclusive: the total is the sum of lines.
 */
export async function createDiningOrder(
	input: CreateOrderInput
): Promise<{ id: string; code: string; accessToken: string; totalCentavos: number }> {
	const { hotelId, venueId } = input;
	if (!(await venueBelongsToHotel(hotelId, venueId))) throw new OrderError('That venue could not be found.');
	if (input.lines.length === 0) throw new OrderError('Add at least one item.');
	if (input.lines.length > MAX_LINES) throw new OrderError(`An order can have up to ${MAX_LINES} lines.`);
	for (const l of input.lines) {
		if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QTY) {
			throw new OrderError(`Quantity must be a whole number from 1 to ${MAX_QTY}.`);
		}
	}

	const [hotel] = await db
		.select({ vatRateBps: hotels.vatRateBps })
		.from(hotels)
		.where(eq(hotels.id, hotelId))
		.limit(1);
	if (!hotel) throw new OrderError('Hotel not found.');

	// --- dishes ---
	const itemIds = [...new Set(input.lines.map((l) => l.menuItemId))];
	const items = await db
		.select({
			id: diningMenuItems.id,
			name: diningMenuItems.name,
			priceCentavos: diningMenuItems.priceCentavos,
			taxable: diningMenuItems.taxable,
			isActive: diningMenuItems.isActive,
			isAvailable: diningMenuItems.isAvailable,
			stationId: diningMenuItems.stationId,
			stationName: diningStations.name
		})
		.from(diningMenuItems)
		.leftJoin(diningStations, eq(diningStations.id, diningMenuItems.stationId))
		.where(
			and(
				inArray(diningMenuItems.id, itemIds),
				eq(diningMenuItems.hotelId, hotelId),
				eq(diningMenuItems.diningItemId, venueId),
				isNull(diningMenuItems.deletedAt)
			)
		);
	const itemById = new Map(items.map((i) => [i.id, i]));
	for (const id of itemIds) {
		const it = itemById.get(id);
		if (!it || !it.isActive) throw new OrderError('One of the items is no longer on the menu.');
		if (!it.isAvailable) throw new OrderError(`${it.name} is sold out.`);
	}

	// --- add-ons: which groups each dish offers, and the add-ons on offer ---
	const links = await db
		.select({ menuItemId: diningMenuItemAddonGroups.menuItemId, groupId: diningMenuItemAddonGroups.addonGroupId })
		.from(diningMenuItemAddonGroups)
		.where(inArray(diningMenuItemAddonGroups.menuItemId, itemIds));
	const groupIds = [...new Set(links.map((l) => l.groupId))];
	const groups = groupIds.length
		? await db
				.select()
				.from(diningAddonGroups)
				.where(and(inArray(diningAddonGroups.id, groupIds), eq(diningAddonGroups.hotelId, hotelId)))
		: [];
	const addons = groupIds.length
		? await db
				.select()
				.from(diningAddons)
				.where(and(inArray(diningAddons.groupId, groupIds), eq(diningAddons.hotelId, hotelId)))
		: [];
	const addonById = new Map(addons.map((a) => [a.id, a]));

	const resolved = input.lines.map((line, sortOrder) => {
		const item = itemById.get(line.menuItemId)!;
		const offered = links.filter((l) => l.menuItemId === item.id).map((l) => l.groupId);
		const chosenIds = [...new Set(line.addonIds ?? [])];
		const chosen = chosenIds.map((id) => {
			const a = addonById.get(id);
			if (!a || !offered.includes(a.groupId)) throw new OrderError(`${item.name}: that option is not offered.`);
			if (!a.isAvailable) throw new OrderError(`${item.name}: ${a.name} is sold out.`);
			return a;
		});
		const chosenByGroup: Record<string, number> = {};
		for (const a of chosen) chosenByGroup[a.groupId] = (chosenByGroup[a.groupId] ?? 0) + 1;
		const rules: AddonGroupRule[] = offered
			.map((gid) => groups.find((g) => g.id === gid))
			.filter((g): g is NonNullable<typeof g> => !!g)
			.map((g) => ({ id: g.id, name: g.name, minChoices: g.minChoices, maxChoices: g.maxChoices }));
		const problem = checkAddonSelection(item.name, rules, chosenByGroup);
		if (problem) throw new OrderError(problem);

		const priced = priceLine({
			unitPriceCentavos: item.priceCentavos,
			addonPricesCentavos: chosen.map((a) => a.priceCentavos),
			quantity: line.quantity,
			taxable: item.taxable,
			vatRateBps: hotel.vatRateBps
		});
		return { line, item, chosen, priced, sortOrder };
	});
	const totals = sumLines(resolved.map((r) => r.priced));
	if (totals.totalCentavos <= 0) throw new OrderError('This order has nothing to charge.');

	// --- table / reservation links ---
	let tableLabel: string | null = null;
	if (input.tableId) {
		const [t] = await db
			.select({ name: diningTables.name })
			.from(diningTables)
			.where(
				and(
					eq(diningTables.id, input.tableId),
					eq(diningTables.hotelId, hotelId),
					eq(diningTables.diningItemId, venueId),
					eq(diningTables.isActive, true)
				)
			)
			.limit(1);
		if (!t) throw new OrderError('Pick a table from this venue.');
		tableLabel = t.name;
	}
	if (input.reservationId) {
		const [res] = await db
			.select({ id: diningReservations.id })
			.from(diningReservations)
			.where(
				and(
					eq(diningReservations.id, input.reservationId),
					eq(diningReservations.hotelId, hotelId),
					eq(diningReservations.diningItemId, venueId)
				)
			)
			.limit(1);
		if (!res) throw new OrderError('That reservation could not be found.');
	}

	const created = await db.transaction(async (tx) => {
		let order: { id: string; code: string; accessToken: string } | null = null;
		for (let attempt = 0; attempt < 6 && !order; attempt++) {
			const code = makeCode();
			const [row] = await tx
				.insert(diningOrders)
				.values({
					hotelId,
					diningItemId: venueId,
					code,
					orderType: input.orderType,
					tableId: input.tableId ?? null,
					tableLabel,
					reservationId: input.reservationId ?? null,
					bookingId: input.bookingId ?? null,
					guestName: input.guestName?.trim() || null,
					guestPhone: input.guestPhone?.trim() || null,
					guestEmail: input.guestEmail?.trim() || null,
					remarks: input.remarks?.trim() || null,
					pickupAt: input.pickupAt ?? null,
					payMode: input.payMode ?? null,
					status: input.initialStatus ?? 'new',
					source: input.source ?? 'staff',
					totalCentavos: totals.totalCentavos,
					vatCentavos: totals.vatCentavos,
					createdByUserId: input.actor?.id ?? null
				})
				.onConflictDoNothing({ target: [diningOrders.hotelId, diningOrders.code] })
				.returning({ id: diningOrders.id, code: diningOrders.code, accessToken: diningOrders.accessToken });
			if (row) order = row;
		}
		if (!order) throw new Error('Could not allocate an order code');

		for (const r of resolved) {
			const [oi] = await tx
				.insert(diningOrderItems)
				.values({
					orderId: order.id,
					menuItemId: r.item.id,
					name: r.item.name,
					stationId: r.item.stationId,
					stationName: r.item.stationName,
					taxable: r.item.taxable,
					quantity: r.line.quantity,
					unitPriceCentavos: r.item.priceCentavos,
					addonsCentavos: r.priced.addonsCentavos,
					lineTotalCentavos: r.priced.lineTotalCentavos,
					vatCentavos: r.priced.vatCentavos,
					remarks: r.line.remarks?.trim() || null,
					sortOrder: r.sortOrder
				})
				.returning({ id: diningOrderItems.id });
			if (r.chosen.length) {
				await tx.insert(diningOrderItemAddons).values(
					r.chosen.map((a) => ({
						orderItemId: oi!.id,
						addonId: a.id,
						name: a.name,
						priceCentavos: a.priceCentavos
					}))
				);
			}
		}

		await writeAudit({
			hotelId,
			actor: input.actor ?? null,
			action: 'dining_order.create',
			entityType: 'dining_order',
			entityId: order.id,
			after: { code: order.code, venueId, lines: resolved.length, totalCentavos: totals.totalCentavos, source: input.source ?? 'staff' }
		});
		return order;
	});

	return { ...created, totalCentavos: totals.totalCentavos };
}

async function loadOrderForUpdate(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], hotelId: string, orderId: string) {
	const [order] = await tx
		.select()
		.from(diningOrders)
		.where(and(eq(diningOrders.id, orderId), eq(diningOrders.hotelId, hotelId)))
		.for('update');
	if (!order) throw new OrderError('That order could not be found.');
	return order;
}

/** Moves an order along the kitchen flow (not to "cancelled", which needs a reason). */
export async function setDiningOrderStatus(args: {
	hotelId: string;
	orderId: string;
	to: Exclude<DiningOrderStatus, 'cancelled' | 'pending_payment'>;
	actor?: Actor;
}): Promise<DiningOrder> {
	const updated = await db.transaction(async (tx) => {
		const order = await loadOrderForUpdate(tx, args.hotelId, args.orderId);
		if (!canMoveOrder(order.status, args.to)) {
			throw new OrderError(`A ${order.status} order can't be marked ${args.to}.`);
		}
		const now = new Date();
		const [updated] = await tx
			.update(diningOrders)
			.set({
				status: args.to,
				acceptedAt: args.to === 'accepted' || args.to === 'preparing' ? (order.acceptedAt ?? now) : order.acceptedAt,
				readyAt: args.to === 'ready' ? now : order.readyAt,
				servedAt: args.to === 'served' ? now : order.servedAt,
				updatedAt: now
			})
			.where(eq(diningOrders.id, order.id))
			.returning();
		await writeAudit({
			hotelId: args.hotelId,
			actor: args.actor ?? null,
			action: 'dining_order.status',
			entityType: 'dining_order',
			entityId: order.id,
			before: { status: order.status },
			after: { status: args.to }
		});
		return updated!;
	});
	// An online guest hears when their order is ready (best-effort, after the move is saved).
	if (args.to === 'ready' && updated.source === 'online') void sendDiningOrderEmail(updated.id, 'ready');
	return updated;
}

/** Cancels an order that has not been paid (a paid order must have its payment voided first). */
export async function cancelDiningOrder(args: {
	hotelId: string;
	orderId: string;
	reason: string;
	actor?: Actor;
}): Promise<void> {
	const reason = args.reason.trim();
	if (!reason) throw new OrderError('Give a reason for cancelling the order.');
	await db.transaction(async (tx) => {
		const order = await loadOrderForUpdate(tx, args.hotelId, args.orderId);
		if (order.paymentStatus !== 'unpaid') {
			throw new OrderError('This order has been paid. Void its payment first, then cancel it.');
		}
		if (!canMoveOrder(order.status, 'cancelled')) {
			throw new OrderError(`A ${order.status} order can't be cancelled.`);
		}
		await tx
			.update(diningOrders)
			.set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date() })
			.where(eq(diningOrders.id, order.id));
		await writeAudit({
			hotelId: args.hotelId,
			actor: args.actor ?? null,
			action: 'dining_order.cancel',
			entityType: 'dining_order',
			entityId: order.id,
			before: { status: order.status },
			after: { status: 'cancelled', reason }
		});
	});
}

/**
 * Takes payment for an order at the cashier. Posts straight to the cash ledger as
 * `dining_revenue` through `recordCashMovement` (the single cash choke point), into the open
 * drawer shift for cash or the bank/e-wallet account otherwise, in the same transaction that
 * marks the order paid. Same accountability as Quick Sale: no open shift, no cash payment.
 */
export async function payDiningOrder(args: {
	hotelId: string;
	orderId: string;
	method: PaymentMethod;
	tenderedCentavos?: number | null;
	actor?: Actor;
}): Promise<{ totalCentavos: number; changeCentavos: number; receiptId: string | null }> {
	const [order] = await db
		.select()
		.from(diningOrders)
		.where(and(eq(diningOrders.id, args.orderId), eq(diningOrders.hotelId, args.hotelId)))
		.limit(1);
	if (!order) throw new OrderError('That order could not be found.');
	if (order.status === 'cancelled') throw new OrderError('A cancelled order cannot be paid.');
	if (order.paymentStatus !== 'unpaid') throw new OrderError('This order is already paid.');

	const [hotel] = await db.select({ timezone: hotels.timezone }).from(hotels).where(eq(hotels.id, args.hotelId)).limit(1);
	if (!hotel) throw new OrderError('Hotel not found.');
	const businessDate = businessDateFor(hotel.timezone);

	let tendered: number | null = null;
	let change = 0;
	if (args.method === 'cash') {
		if (!Number.isInteger(args.tenderedCentavos) || (args.tenderedCentavos ?? 0) < order.totalCentavos) {
			throw new FinanceError('Cash tendered must cover the total.');
		}
		tendered = args.tenderedCentavos!;
		change = changeFor(tendered, order.totalCentavos);
	}

	const { cashAccountId, shiftId } = await resolvePaymentAccount(args.hotelId, args.method);

	await db.transaction(async (tx) => {
		const locked = await loadOrderForUpdate(tx, args.hotelId, args.orderId);
		if (locked.paymentStatus !== 'unpaid') throw new OrderError('This order is already paid.');
		if (locked.status === 'cancelled') throw new OrderError('A cancelled order cannot be paid.');

		const movementId = await recordCashMovement(
			{
				hotelId: args.hotelId,
				businessDate,
				direction: 'in',
				category: 'dining_revenue',
				cashAccountId,
				amountCentavos: locked.totalCentavos,
				counterpartyType: locked.guestName ? 'guest' : null,
				counterpartyName: locked.guestName,
				sourceType: 'dining_order',
				sourceId: locked.id,
				shiftId,
				memo: `Dining ${locked.code}${locked.tableLabel ? ` table ${locked.tableLabel}` : ''}`,
				actor: args.actor ?? null
			},
			tx
		);

		await tx
			.update(diningOrders)
			.set({
				paymentStatus: 'paid',
				businessDate,
				paymentMethod: args.method,
				tenderedCentavos: tendered,
				changeCentavos: change,
				cashAccountId,
				shiftId,
				cashMovementId: movementId,
				paidAt: new Date(),
				paidByUserId: args.actor?.id ?? null,
				updatedAt: new Date()
			})
			.where(eq(diningOrders.id, locked.id));

		await writeAudit({
			hotelId: args.hotelId,
			actor: args.actor ?? null,
			action: 'dining_order.paid',
			entityType: 'dining_order',
			entityId: locked.id,
			after: { code: locked.code, totalCentavos: locked.totalCentavos, method: args.method }
		});
	});

	// The payment stands even if the receipt can't be issued (no active OR series, say): the
	// cashier sees a null receipt and can issue it later from the order once the series is fixed.
	let receiptId: string | null = null;
	const bir = await getBirSettings(args.hotelId).catch(() => null);
	if (bir?.autoIssueReceiptOnPayment) {
		try {
			receiptId = (await issueDiningDocument(args.hotelId, args.orderId, 'official_receipt', args.actor ?? null)).id;
		} catch (e) {
			console.warn('payDiningOrder: could not issue official receipt', args.orderId, e);
		}
	}

	return { totalCentavos: order.totalCentavos, changeCentavos: change, receiptId };
}

/** Voids a paid order's payment (a manager action): reverses the ledger entry and puts the
 *  order back to unpaid so it can be re-paid or cancelled. */
export async function voidDiningOrderPayment(args: {
	hotelId: string;
	orderId: string;
	reason: string;
	actor?: Actor;
}): Promise<void> {
	const reason = args.reason.trim();
	if (!reason) throw new OrderError('Give a reason for voiding the payment.');
	const [order] = await db
		.select()
		.from(diningOrders)
		.where(and(eq(diningOrders.id, args.orderId), eq(diningOrders.hotelId, args.hotelId)))
		.limit(1);
	if (!order) throw new OrderError('That order could not be found.');
	if (order.paymentStatus !== 'paid' || !order.cashMovementId) throw new OrderError('This order has no payment to void.');

	// If a previous attempt voided the movement but failed to update the order, don't void twice.
	const [movement] = await db
		.select({ voidedAt: cashMovements.voidedAt })
		.from(cashMovements)
		.where(and(eq(cashMovements.id, order.cashMovementId), eq(cashMovements.hotelId, args.hotelId)))
		.limit(1);
	if (!movement?.voidedAt) {
		await voidCashMovement(args.hotelId, order.cashMovementId, `Dining ${order.code}: ${reason}`, args.actor ?? null);
	}

	// No receipt may stay in force for money that was reversed (the serial is kept, per BIR).
	await cancelDiningReceipt(args.hotelId, order.id, `Payment voided: ${reason}`, args.actor ?? null).catch((e) => {
		console.warn('voidDiningOrderPayment: could not cancel receipt', order.id, e);
	});

	await db
		.update(diningOrders)
		.set({
			paymentStatus: 'unpaid',
			paymentMethod: null,
			tenderedCentavos: null,
			changeCentavos: 0,
			cashAccountId: null,
			shiftId: null,
			cashMovementId: null,
			paidAt: null,
			paidByUserId: null,
			businessDate: null,
			updatedAt: new Date()
		})
		.where(eq(diningOrders.id, order.id));
	await writeAudit({
		hotelId: args.hotelId,
		actor: args.actor ?? null,
		action: 'dining_order.void_payment',
		entityType: 'dining_order',
		entityId: order.id,
		after: { code: order.code, reason }
	});
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface OrderView {
	id: string;
	code: string;
	status: DiningOrderStatus;
	paymentStatus: DiningOrder['paymentStatus'];
	orderType: DiningOrderType;
	venueId: string;
	venueTitle: string;
	tableLabel: string | null;
	guestName: string | null;
	guestPhone: string | null;
	bookingCode: string | null;
	remarks: string | null;
	source: string;
	totalCentavos: number;
	vatCentavos: number;
	paymentMethod: string | null;
	createdAt: Date;
	acceptedAt: Date | null;
	readyAt: Date | null;
	servedAt: Date | null;
	items: {
		id: string;
		name: string;
		quantity: number;
		remarks: string | null;
		stationName: string | null;
		lineTotalCentavos: number;
		addons: string[];
	}[];
}

async function hydrate(rows: { o: DiningOrder; venueTitle: string; bookingOrderId: string | null }[]): Promise<OrderView[]> {
	if (rows.length === 0) return [];
	const orderIds = rows.map((r) => r.o.id);
	const items = await db
		.select()
		.from(diningOrderItems)
		.where(inArray(diningOrderItems.orderId, orderIds))
		.orderBy(asc(diningOrderItems.sortOrder));
	const addons = items.length
		? await db
				.select()
				.from(diningOrderItemAddons)
				.where(inArray(diningOrderItemAddons.orderItemId, items.map((i) => i.id)))
		: [];
	return rows.map(({ o, venueTitle, bookingOrderId }) => ({
		id: o.id,
		code: o.code,
		status: o.status,
		paymentStatus: o.paymentStatus,
		orderType: o.orderType,
		venueId: o.diningItemId,
		venueTitle,
		tableLabel: o.tableLabel,
		guestName: o.guestName,
		guestPhone: o.guestPhone,
		bookingCode: bookingOrderId ? bookingOrderId.slice(0, 8).toUpperCase() : null,
		remarks: o.remarks,
		source: o.source,
		totalCentavos: o.totalCentavos,
		vatCentavos: o.vatCentavos,
		paymentMethod: o.paymentMethod,
		createdAt: o.createdAt,
		acceptedAt: o.acceptedAt,
		readyAt: o.readyAt,
		servedAt: o.servedAt,
		items: items
			.filter((i) => i.orderId === o.id)
			.map((i) => ({
				id: i.id,
				name: i.name,
				quantity: i.quantity,
				remarks: i.remarks,
				stationName: i.stationName,
				lineTotalCentavos: i.lineTotalCentavos,
				addons: addons.filter((a) => a.orderItemId === i.id).map((a) => a.name)
			}))
	}));
}

const orderSelect = () =>
	db
		.select({ o: diningOrders, venueTitle: diningItems.title, bookingOrderId: sql<string | null>`(select order_id from bookings where bookings.id = ${diningOrders.bookingId})` })
		.from(diningOrders)
		.innerJoin(diningItems, eq(diningItems.id, diningOrders.diningItemId));

/** The live board: everything still moving through the kitchen, plus orders served since
 *  `servedSince` (so a served-but-unpaid table is still visible at the cashier). */
export async function listBoardOrders(hotelId: string, opts: { venueId?: string | null; servedSince: Date }): Promise<OrderView[]> {
	const rows = await orderSelect()
		.where(
			and(
				eq(diningOrders.hotelId, hotelId),
				opts.venueId ? eq(diningOrders.diningItemId, opts.venueId) : undefined,
				or(
					inArray(diningOrders.status, ['new', 'accepted', 'preparing', 'ready']),
					and(eq(diningOrders.status, 'served'), gte(diningOrders.servedAt, opts.servedSince))
				)
			)
		)
		.orderBy(asc(diningOrders.createdAt));
	return hydrate(rows);
}

export async function getDiningOrder(hotelId: string, orderId: string): Promise<OrderView | null> {
	const rows = await orderSelect().where(and(eq(diningOrders.hotelId, hotelId), eq(diningOrders.id, orderId))).limit(1);
	return (await hydrate(rows))[0] ?? null;
}

export async function listRecentOrders(hotelId: string, opts: { venueId?: string | null; limit?: number }): Promise<OrderView[]> {
	const rows = await orderSelect()
		.where(and(eq(diningOrders.hotelId, hotelId), opts.venueId ? eq(diningOrders.diningItemId, opts.venueId) : undefined))
		.orderBy(desc(diningOrders.createdAt))
		.limit(opts.limit ?? 50);
	return hydrate(rows);
}

// ---------------------------------------------------------------------------
// Sales report
// ---------------------------------------------------------------------------

export interface DiningSalesReport {
	from: string;
	to: string;
	orders: number;
	grossCentavos: number;
	vatCentavos: number;
	byDay: { date: string; orders: number; grossCentavos: number }[];
	byVenue: { venueId: string; venue: string; orders: number; grossCentavos: number }[];
	byStation: { station: string; quantity: number; grossCentavos: number }[];
	byItem: { name: string; quantity: number; grossCentavos: number }[];
	byMethod: { method: string; orders: number; grossCentavos: number }[];
}

/** Paid dining sales between two business dates (inclusive), by day, venue, station, dish and
 *  payment method. Counts only `paid` orders, so a voided payment drops out of the totals. */
export async function diningSalesReport(
	hotelId: string,
	from: string,
	to: string,
	venueId?: string | null
): Promise<DiningSalesReport> {
	const where = and(
		eq(diningOrders.hotelId, hotelId),
		eq(diningOrders.paymentStatus, 'paid'),
		ne(diningOrders.status, 'cancelled'),
		gte(diningOrders.businessDate, from),
		lte(diningOrders.businessDate, to),
		venueId ? eq(diningOrders.diningItemId, venueId) : undefined
	);
	const n = (v: unknown) => Number(v ?? 0);

	const [totals] = await db
		.select({
			orders: sql<number>`count(*)`,
			gross: sql<number>`coalesce(sum(${diningOrders.totalCentavos}), 0)`,
			vat: sql<number>`coalesce(sum(${diningOrders.vatCentavos}), 0)`
		})
		.from(diningOrders)
		.where(where);

	const byDay = await db
		.select({
			date: diningOrders.businessDate,
			orders: sql<number>`count(*)`,
			gross: sql<number>`coalesce(sum(${diningOrders.totalCentavos}), 0)`
		})
		.from(diningOrders)
		.where(where)
		.groupBy(diningOrders.businessDate)
		.orderBy(asc(diningOrders.businessDate));

	const byVenue = await db
		.select({
			venueId: diningOrders.diningItemId,
			venue: diningItems.title,
			orders: sql<number>`count(*)`,
			gross: sql<number>`coalesce(sum(${diningOrders.totalCentavos}), 0)`
		})
		.from(diningOrders)
		.innerJoin(diningItems, eq(diningItems.id, diningOrders.diningItemId))
		.where(where)
		.groupBy(diningOrders.diningItemId, diningItems.title)
		.orderBy(desc(sql`sum(${diningOrders.totalCentavos})`));

	const byMethod = await db
		.select({
			method: diningOrders.paymentMethod,
			orders: sql<number>`count(*)`,
			gross: sql<number>`coalesce(sum(${diningOrders.totalCentavos}), 0)`
		})
		.from(diningOrders)
		.where(where)
		.groupBy(diningOrders.paymentMethod)
		.orderBy(desc(sql`sum(${diningOrders.totalCentavos})`));

	const itemRows = await db
		.select({
			name: diningOrderItems.name,
			station: diningOrderItems.stationName,
			quantity: sql<number>`coalesce(sum(${diningOrderItems.quantity}), 0)`,
			gross: sql<number>`coalesce(sum(${diningOrderItems.lineTotalCentavos}), 0)`
		})
		.from(diningOrderItems)
		.innerJoin(diningOrders, eq(diningOrders.id, diningOrderItems.orderId))
		.where(where)
		.groupBy(diningOrderItems.name, diningOrderItems.stationName);

	const byItem = new Map<string, { quantity: number; grossCentavos: number }>();
	const byStation = new Map<string, { quantity: number; grossCentavos: number }>();
	for (const r of itemRows) {
		const i = byItem.get(r.name) ?? { quantity: 0, grossCentavos: 0 };
		i.quantity += n(r.quantity);
		i.grossCentavos += n(r.gross);
		byItem.set(r.name, i);
		const key = r.station ?? 'No station';
		const s = byStation.get(key) ?? { quantity: 0, grossCentavos: 0 };
		s.quantity += n(r.quantity);
		s.grossCentavos += n(r.gross);
		byStation.set(key, s);
	}

	return {
		from,
		to,
		orders: n(totals?.orders),
		grossCentavos: n(totals?.gross),
		vatCentavos: n(totals?.vat),
		byDay: byDay.map((d) => ({ date: d.date ?? '', orders: n(d.orders), grossCentavos: n(d.gross) })),
		byVenue: byVenue.map((v) => ({ venueId: v.venueId, venue: v.venue, orders: n(v.orders), grossCentavos: n(v.gross) })),
		byStation: [...byStation.entries()]
			.map(([station, v]) => ({ station, ...v }))
			.sort((a, b) => b.grossCentavos - a.grossCentavos),
		byItem: [...byItem.entries()]
			.map(([name, v]) => ({ name, ...v }))
			.sort((a, b) => b.grossCentavos - a.grossCentavos)
			.slice(0, 25),
		byMethod: byMethod.map((m) => ({ method: m.method ?? 'unknown', orders: n(m.orders), grossCentavos: n(m.gross) }))
	};
}

/** Documents currently in force for an order (receipt / invoice numbers for the card). */
export const getOrderDocuments = listDiningOrderDocuments;
