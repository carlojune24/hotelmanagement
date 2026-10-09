import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from './db/index';
import {
	diningItems,
	diningOrderItemAddons,
	diningOrderItems,
	diningOrders,
	diningTableChecks,
	diningTables,
	hotels
} from './db/schema/index';
import { getBirSettings } from './finance/documents';
import { buildBill, type BillOrderInput, type BillTotals } from '../dining-bill';

/**
 * The printed guest bill: what a table (or one order) ordered and what it costs. It is a plain
 * statement, not a BIR document: no serial is allocated and no `documents` row is written, so it
 * can be printed as often as the guest wants before they pay.
 */
export interface GuestBill extends BillTotals {
	/** Just the name: a bill is not a tax document, so no TIN or address. */
	hotel: { name: string };
	venue: string;
	/** `Table 4`, or `Takeaway` / `Dine-in` for an order with no table. */
	where: string;
	guestName: string | null;
	timezone: string;
	printedAtIso: string;
	widthMm: 58 | 80;
}

/** Orders with their lines and add-on names, oldest first. */
async function loadOrders(hotelId: string, where: ReturnType<typeof eq>): Promise<(BillOrderInput & { guestName: string | null; orderType: string; tableLabel: string | null; venueId: string })[]> {
	const orders = await db
		.select()
		.from(diningOrders)
		.where(and(eq(diningOrders.hotelId, hotelId), where))
		.orderBy(asc(diningOrders.createdAt));
	if (orders.length === 0) return [];

	const items = await db
		.select()
		.from(diningOrderItems)
		.where(inArray(diningOrderItems.orderId, orders.map((o) => o.id)))
		.orderBy(asc(diningOrderItems.sortOrder));
	const addons = items.length
		? await db
				.select({ orderItemId: diningOrderItemAddons.orderItemId, name: diningOrderItemAddons.name })
				.from(diningOrderItemAddons)
				.where(inArray(diningOrderItemAddons.orderItemId, items.map((i) => i.id)))
		: [];

	return orders.map((o) => ({
		id: o.id,
		code: o.code,
		status: o.status,
		paymentStatus: o.paymentStatus,
		totalCentavos: o.totalCentavos,
		vatCentavos: o.vatCentavos,
		guestName: o.guestName,
		orderType: o.orderType,
		tableLabel: o.tableLabel,
		venueId: o.diningItemId,
		items: items
			.filter((i) => i.orderId === o.id)
			.map((i) => ({
				name: i.name,
				quantity: i.quantity,
				unitPriceCentavos: i.unitPriceCentavos,
				addonsCentavos: i.addonsCentavos,
				lineTotalCentavos: i.lineTotalCentavos,
				addons: addons.filter((a) => a.orderItemId === i.id).map((a) => a.name)
			}))
	}));
}

async function frame(hotelId: string) {
	const [[h], bir] = await Promise.all([
		db
			.select({ name: hotels.name, timezone: hotels.timezone })
			.from(hotels)
			.where(eq(hotels.id, hotelId))
			.limit(1),
		getBirSettings(hotelId)
	]);
	return {
		hotel: { name: h?.name ?? '' },
		timezone: h?.timezone ?? 'Asia/Manila',
		widthMm: (bir?.thermalPaperWidthMm === 58 ? 58 : 80) as 58 | 80
	};
}

async function venueTitle(hotelId: string, venueId: string) {
	const [v] = await db
		.select({ title: diningItems.title })
		.from(diningItems)
		.where(and(eq(diningItems.id, venueId), eq(diningItems.hotelId, hotelId)))
		.limit(1);
	return v?.title ?? '';
}

/** Every live order on a table's check (open or already closed). Null when the check isn't this hotel's. */
export async function getBillForCheck(hotelId: string, checkId: string): Promise<GuestBill | null> {
	const [check] = await db
		.select({ id: diningTableChecks.id, venueId: diningTableChecks.diningItemId, tableId: diningTableChecks.tableId })
		.from(diningTableChecks)
		.where(and(eq(diningTableChecks.id, checkId), eq(diningTableChecks.hotelId, hotelId)))
		.limit(1);
	if (!check) return null;

	const [orders, base, venue, [table]] = await Promise.all([
		loadOrders(hotelId, eq(diningOrders.checkId, check.id)),
		frame(hotelId),
		venueTitle(hotelId, check.venueId),
		db.select({ name: diningTables.name }).from(diningTables).where(eq(diningTables.id, check.tableId)).limit(1)
	]);
	return {
		...buildBill(orders),
		...base,
		venue,
		where: `Table ${table?.name ?? orders[0]?.tableLabel ?? ''}`.trim(),
		guestName: orders.find((o) => o.guestName)?.guestName ?? null,
		printedAtIso: new Date().toISOString()
	};
}

/** One order, for a takeaway or an order with no table check. Null when it isn't this hotel's. */
export async function getBillForOrder(hotelId: string, orderId: string): Promise<GuestBill | null> {
	const orders = await loadOrders(hotelId, eq(diningOrders.id, orderId));
	const o = orders[0];
	if (!o) return null;
	const [base, venue] = await Promise.all([frame(hotelId), venueTitle(hotelId, o.venueId)]);
	return {
		...buildBill(orders),
		...base,
		venue,
		where: o.tableLabel ? `Table ${o.tableLabel}` : o.orderType === 'takeaway' ? 'Takeaway' : o.orderType === 'pre_order' ? 'Pre-order' : 'Dine-in',
		guestName: o.guestName,
		printedAtIso: new Date().toISOString()
	};
}
