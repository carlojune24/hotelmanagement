import { and, asc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { db } from './db/index';
import {
	diningAreas,
	diningItems,
	diningOrderItemAddons,
	diningOrderItems,
	diningOrders,
	diningTableChecks,
	diningTables
} from './db/schema/index';
import { OrderError, cancelDiningOrder, createDiningOrder, type OrderLineInput } from './dining-orders';
import { requestBill } from './dining-checks';

/** The guest's browser remembers its own orders (code + access token) in a cookie, so the table
 *  page can show them back without a login, and nobody else at the table can see or cancel them. */
export const QR_COOKIE = 'dqr';
const KEEP_HOURS = 12;
const MAX_REMEMBERED = 12;

export interface RememberedOrder {
	code: string;
	token: string;
}

export function parseRemembered(raw: string | undefined): RememberedOrder[] {
	if (!raw) return [];
	try {
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr)) return [];
		return arr
			.filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string')
			.slice(-MAX_REMEMBERED)
			.map(([code, token]) => ({ code, token }));
	} catch {
		return [];
	}
}

export const serializeRemembered = (list: RememberedOrder[]) =>
	JSON.stringify(list.slice(-MAX_REMEMBERED).map((r) => [r.code, r.token]));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface QrTable {
	id: string;
	name: string;
	seats: number;
	areaName: string | null;
	venueId: string;
	venueTitle: string;
}

/** The table a QR code points at, or null when the code is unknown, rotated, or the table/venue is retired. */
export async function resolveQrTable(hotelId: string, token: string): Promise<QrTable | null> {
	if (!UUID.test(token)) return null;
	const [row] = await db
		.select({
			id: diningTables.id,
			name: diningTables.name,
			seats: diningTables.seats,
			areaName: diningAreas.name,
			venueId: diningItems.id,
			venueTitle: diningItems.title
		})
		.from(diningTables)
		.innerJoin(diningItems, eq(diningItems.id, diningTables.diningItemId))
		.leftJoin(diningAreas, eq(diningAreas.id, diningTables.areaId))
		.where(
			and(
				eq(diningTables.qrToken, token),
				eq(diningTables.hotelId, hotelId),
				eq(diningTables.isActive, true),
				eq(diningItems.isActive, true)
			)
		)
		.limit(1);
	return row ?? null;
}

export interface QrOrderView {
	code: string;
	status: string;
	paymentStatus: string;
	totalCentavos: number;
	createdAt: string;
	cancelReason: string | null;
	items: { name: string; quantity: number; addons: string[] }[];
}

/** What this browser has ordered at this table recently. */
export async function listMyQrOrders(hotelId: string, tableId: string, remembered: RememberedOrder[]) {
	const since = new Date(Date.now() - KEEP_HOURS * 3_600_000);
	const valid = remembered.filter((r) => UUID.test(r.token));
	if (valid.length === 0) return { orders: [] as QrOrderView[], checkOpen: false, billRequested: false };

	const rows = await db
		.select()
		.from(diningOrders)
		.where(
			and(
				eq(diningOrders.hotelId, hotelId),
				eq(diningOrders.tableId, tableId),
				gt(diningOrders.createdAt, since),
				inArray(diningOrders.code, valid.map((r) => r.code))
			)
		)
		.orderBy(asc(diningOrders.createdAt));
	const mine = rows.filter((o) => valid.some((r) => r.code === o.code && r.token === o.accessToken));

	const items = mine.length
		? await db.select().from(diningOrderItems).where(inArray(diningOrderItems.orderId, mine.map((o) => o.id))).orderBy(asc(diningOrderItems.sortOrder))
		: [];
	const addons = items.length
		? await db.select().from(diningOrderItemAddons).where(inArray(diningOrderItemAddons.orderItemId, items.map((i) => i.id)))
		: [];

	const checkIds = [...new Set(mine.map((o) => o.checkId).filter((x): x is string => !!x))];
	const checks = checkIds.length
		? await db.select().from(diningTableChecks).where(and(inArray(diningTableChecks.id, checkIds), eq(diningTableChecks.status, 'open')))
		: [];

	return {
		orders: mine.map(
			(o): QrOrderView => ({
				code: o.code,
				status: o.status,
				paymentStatus: o.paymentStatus,
				totalCentavos: o.totalCentavos,
				createdAt: o.createdAt.toISOString(),
				cancelReason: o.cancelReason,
				items: items
					.filter((i) => i.orderId === o.id)
					.map((i) => ({ name: i.name, quantity: i.quantity, addons: addons.filter((a) => a.orderItemId === i.id).map((a) => a.name) }))
			})
		),
		checkOpen: checks.length > 0,
		billRequested: checks.some((c) => c.billRequestedAt)
	};
}

/** Places a table-QR order. It waits for a waiter to accept it, and does not occupy the table until then. */
export async function placeQrOrder(args: {
	hotelId: string;
	table: QrTable;
	lines: OrderLineInput[];
	guestName?: string | null;
	remarks?: string | null;
}) {
	return createDiningOrder({
		hotelId: args.hotelId,
		venueId: args.table.venueId,
		orderType: 'dine_in',
		tableId: args.table.id,
		lines: args.lines,
		guestName: args.guestName,
		remarks: args.remarks,
		source: 'qr',
		initialStatus: 'pending_acceptance'
	});
}

/** A guest withdraws an order nobody has accepted yet. */
export async function cancelMyQrOrder(args: { hotelId: string; tableId: string; remembered: RememberedOrder[]; code: string }) {
	const r = args.remembered.find((x) => x.code === args.code);
	if (!r) throw new OrderError('We could not find that order.');
	const [o] = await db
		.select()
		.from(diningOrders)
		.where(and(eq(diningOrders.hotelId, args.hotelId), eq(diningOrders.tableId, args.tableId), eq(diningOrders.code, args.code)))
		.limit(1);
	if (!o || o.accessToken !== r.token) throw new OrderError('We could not find that order.');
	if (o.status !== 'pending_acceptance') throw new OrderError('The restaurant has already seen this order. Please ask your waiter.');
	await cancelDiningOrder({ hotelId: args.hotelId, orderId: o.id, reason: 'Cancelled by the guest' });
}

/** The guest asks for the bill. Only someone who has an order on the open check can. */
export async function requestMyBill(args: { hotelId: string; tableId: string; remembered: RememberedOrder[] }) {
	const mine = await listMyQrOrders(args.hotelId, args.tableId, args.remembered);
	if (!mine.checkOpen) throw new OrderError('There is no open bill for this table yet.');
	const [o] = await db
		.select({ checkId: diningOrders.checkId })
		.from(diningOrders)
		.where(and(eq(diningOrders.hotelId, args.hotelId), eq(diningOrders.tableId, args.tableId), isNotNull(diningOrders.checkId), inArray(diningOrders.code, mine.orders.map((x) => x.code))))
		.limit(1);
	if (!o?.checkId) throw new OrderError('There is no open bill for this table yet.');
	await requestBill({ hotelId: args.hotelId, checkId: o.checkId });
}
