import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import {
	bookingRooms,
	bookings,
	diningAddons,
	diningMenuItems,
	diningOrderItemAddons,
	diningOrderItems,
	diningOrders,
	expenses,
	guests,
	orders,
	roomTypes,
	stockCheckinKitLines,
	stockCountLines,
	stockCounts,
	stockItems,
	stockMovements,
	stockRecipeLines,
	stockRestocks,
	users,
	type StockItem
} from '$lib/server/db/schema/index';
import type { SessionUser } from '$lib/server/auth/session';
import { writeAudit } from '$lib/server/audit';
import { createExpense, voidExpense } from '$lib/server/finance/expenses';
import { formatQty } from '$lib/stock-units';

/**
 * Stock ledger. No prices. FIFO follows WashSuite's `consumeStock`: positive movements are
 * batches, draw-downs take from the oldest open batch first, and whatever the batches can't
 * cover is still recorded (unbatched) so stock goes negative rather than blocking anything.
 */
export class StockError extends Error {}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Department = StockItem['department'];
type Kind = StockItem['kind'];
type Unit = StockItem['unit'];

export interface StockItemInput {
	name: string;
	department: Department;
	kind: Kind;
	unit: Unit;
	reorderLevelMilli: number | null;
	isActive?: boolean;
}

function cleanItem(input: StockItemInput): StockItemInput {
	const name = input.name.trim();
	if (!name) throw new StockError('Give the item a name.');
	if (input.reorderLevelMilli != null && (!Number.isSafeInteger(input.reorderLevelMilli) || input.reorderLevelMilli < 0))
		throw new StockError('Reorder level must be zero or more.');
	return { ...input, name };
}

/** Postgres unique violation on `stock_items_hotel_name_uq`. */
function isDuplicateName(e: unknown): boolean {
	const err = e as { code?: string; cause?: { code?: string } };
	return err?.code === '23505' || err?.cause?.code === '23505';
}

export async function createStockItem(hotelId: string, input: StockItemInput, actor: SessionUser | null): Promise<string> {
	const v = cleanItem(input);
	try {
		return await db.transaction(async (tx) => {
			const [row] = await tx
				.insert(stockItems)
				.values({ hotelId, name: v.name, department: v.department, kind: v.kind, unit: v.unit, reorderLevelMilli: v.reorderLevelMilli })
				.returning();
			await writeAudit({ hotelId, actor, action: 'stock_item.create', entityType: 'stock_item', entityId: row!.id, after: row, tx });
			return row!.id;
		});
	} catch (e) {
		if (isDuplicateName(e)) throw new StockError(`There is already an item called "${v.name}".`);
		throw e;
	}
}

export async function updateStockItem(hotelId: string, itemId: string, input: StockItemInput, actor: SessionUser | null): Promise<void> {
	const v = cleanItem(input);
	try {
		await db.transaction(async (tx) => {
			const before = await lockItem(tx, hotelId, itemId);
			if (before.unit !== v.unit) {
				const [used] = await tx.select({ id: stockMovements.id }).from(stockMovements).where(eq(stockMovements.itemId, itemId)).limit(1);
				// Stored quantities are in the old unit; switching would silently rescale them.
				if (used) throw new StockError('The unit can’t change once stock has moved. Add a new item instead.');
			}
			const [after] = await tx
				.update(stockItems)
				.set({ ...v, isActive: v.isActive ?? before.isActive, updatedAt: new Date() })
				.where(eq(stockItems.id, itemId))
				.returning();
			await writeAudit({ hotelId, actor, action: 'stock_item.update', entityType: 'stock_item', entityId: itemId, before, after, tx });
		});
	} catch (e) {
		if (isDuplicateName(e)) throw new StockError(`There is already an item called "${v.name}".`);
		throw e;
	}
}

/** Locks the item row so two draw-downs (or a draw-down and a restock) on it run one after the other. */
async function lockItem(tx: Tx, hotelId: string, itemId: string): Promise<StockItem> {
	const [item] = await tx
		.select()
		.from(stockItems)
		.where(and(eq(stockItems.id, itemId), eq(stockItems.hotelId, hotelId), isNull(stockItems.deletedAt)))
		.for('update');
	if (!item) throw new StockError('Stock item not found.');
	return item;
}

async function onHand(tx: Tx, itemId: string): Promise<number> {
	const [r] = await tx
		.select({ q: sql<string>`coalesce(sum(${stockMovements.qtyMilli}), 0)` })
		.from(stockMovements)
		.where(eq(stockMovements.itemId, itemId));
	return Number(r!.q);
}

/**
 * How much of a quantity coming back into stock (restock or reversal) becomes open batch: whatever
 * lifts on hand above zero. Covering an oversold deficit first keeps open batches equal to real on hand.
 */
export function batchCredit(onHandBefore: number, qtyMilli: number): number {
	return Math.max(0, onHandBefore + qtyMilli) - Math.max(0, onHandBefore);
}

function assertQty(qtyMilli: number) {
	if (!Number.isSafeInteger(qtyMilli) || qtyMilli <= 0) throw new StockError('Enter a quantity above zero.');
}

export interface ReceiveInput {
	hotelId: string;
	itemId: string;
	qtyMilli: number;
	type?: 'restock' | 'adjust_in';
	expiresOn?: string | null;
	packCount?: number | null;
	packBonus?: number | null;
	packSizeMilli?: number | null;
	note?: string | null;
	actor: SessionUser | null;
}

/** Adds a batch. If stock was negative (oversold), the batch first covers that deficit, so open
 *  batches never add up to more than is really on hand. */
export async function receiveStock(input: ReceiveInput): Promise<void> {
	assertQty(input.qtyMilli);
	const type = input.type ?? 'restock';
	const note = input.note?.trim() || null;
	if (type === 'adjust_in' && !note) throw new StockError('Say why stock is being added.');
	await db.transaction(async (tx) => {
		const item = await lockItem(tx, input.hotelId, input.itemId);
		if (!item.isActive) throw new StockError(`${item.name} is inactive. Turn it back on first.`);
		const before = await onHand(tx, item.id);
		await tx.insert(stockMovements).values({
			hotelId: input.hotelId,
			itemId: item.id,
			type,
			qtyMilli: input.qtyMilli,
			qtyRemainingMilli: batchCredit(before, input.qtyMilli),
			expiresOn: input.expiresOn || null,
			packCount: input.packCount ?? null,
			packBonus: input.packBonus ?? null,
			packSizeMilli: input.packSizeMilli ?? null,
			note,
			createdBy: input.actor?.id ?? null
		});
	});
}

export interface DrawDownInput {
	hotelId: string;
	itemId: string;
	qtyMilli: number;
	type: 'waste' | 'adjust_out' | 'order' | 'checkin_kit';
	note: string | null;
	actorId: string | null;
	diningOrderId?: string | null;
	bookingId?: string | null;
	countId?: string | null;
}

/**
 * Takes `qtyMilli` out of stock, oldest batch first, inside the caller's transaction (dining
 * orders and check-ins will call this from their own). One row per batch drawn from; the part no
 * batch covers is recorded unbatched, leaving on hand negative.
 */
export async function drawDown(tx: Tx, input: DrawDownInput): Promise<void> {
	assertQty(input.qtyMilli);
	const item = await lockItem(tx, input.hotelId, input.itemId);
	const batches = await tx
		.select({ id: stockMovements.id, left: stockMovements.qtyRemainingMilli })
		.from(stockMovements)
		.where(and(eq(stockMovements.itemId, item.id), gt(stockMovements.qtyRemainingMilli, 0)))
		.orderBy(asc(stockMovements.createdAt), asc(stockMovements.id));
	const base = {
		hotelId: input.hotelId,
		itemId: item.id,
		type: input.type,
		note: input.note,
		createdBy: input.actorId,
		diningOrderId: input.diningOrderId ?? null,
		bookingId: input.bookingId ?? null,
		countId: input.countId ?? null
	};
	let remaining = input.qtyMilli;
	for (const b of batches) {
		if (remaining <= 0) break;
		const take = Math.min(b.left ?? 0, remaining);
		await tx
			.update(stockMovements)
			.set({ qtyRemainingMilli: sql`${stockMovements.qtyRemainingMilli} - ${take}` })
			.where(eq(stockMovements.id, b.id));
		await tx.insert(stockMovements).values({ ...base, qtyMilli: -take, consumedFromId: b.id });
		remaining -= take;
	}
	if (remaining > 0) await tx.insert(stockMovements).values({ ...base, qtyMilli: -remaining });
}

/**
 * A physical count: sets on hand to `countedMilli` by posting the difference (an `adjust_in` batch
 * or an `adjust_out` draw-down) under the item lock, so a sale landing mid-count can't be lost.
 */
export async function correctCount(input: { hotelId: string; itemId: string; countedMilli: number; note: string | null; actor: SessionUser | null }): Promise<number> {
	if (!Number.isSafeInteger(input.countedMilli) || input.countedMilli < 0) throw new StockError('Enter what you counted (zero or more).');
	const note = input.note?.trim() || null;
	if (!note) throw new StockError('Say why the count is being corrected.');
	return db.transaction(async (tx) => {
		const { name, diff } = await postCount(tx, { hotelId: input.hotelId, itemId: input.itemId, countedMilli: input.countedMilli, note, actorId: input.actor?.id ?? null });
		if (diff === 0) throw new StockError(`${name} already shows that much. Nothing to correct.`);
		return diff;
	});
}

/** Sets an item's on hand to what was counted by posting the difference, under the item lock. */
async function postCount(
	tx: Tx,
	input: { hotelId: string; itemId: string; countedMilli: number; note: string | null; actorId: string | null; countId?: string | null }
): Promise<{ name: string; before: number; diff: number }> {
	const item = await lockItem(tx, input.hotelId, input.itemId);
	const before = await onHand(tx, item.id);
	const diff = input.countedMilli - before;
	if (diff > 0) {
		await tx.insert(stockMovements).values({
			hotelId: input.hotelId,
			itemId: item.id,
			type: 'adjust_in',
			qtyMilli: diff,
			qtyRemainingMilli: batchCredit(before, diff),
			note: input.note,
			createdBy: input.actorId,
			countId: input.countId ?? null
		});
	} else if (diff < 0) {
		await drawDown(tx, { hotelId: input.hotelId, itemId: item.id, qtyMilli: -diff, type: 'adjust_out', note: input.note, actorId: input.actorId, countId: input.countId });
	}
	return { name: item.name, before, diff };
}

/** Staff-entered waste / correction, its own transaction. */
export async function removeStock(
	input: Omit<DrawDownInput, 'actorId' | 'type' | 'diningOrderId' | 'bookingId' | 'countId'> & { type: 'waste' | 'adjust_out'; actor: SessionUser | null }
): Promise<void> {
	const note = input.note?.trim() || null;
	if (!note) throw new StockError(input.type === 'waste' ? 'Say what was wasted and why.' : 'Say why stock is being removed.');
	await db.transaction((tx) => drawDown(tx, { ...input, note, actorId: input.actor?.id ?? null }));
}

export interface StockRow extends StockItem {
	onHandMilli: number;
	/** Earliest expiry among batches that still have stock. */
	nextExpiry: string | null;
	isLow: boolean;
	/** Stock has moved, so the unit is fixed (`updateStockItem`). */
	hasMoves: boolean;
}

export async function listStock(hotelId: string): Promise<StockRow[]> {
	const rows = await db
		.select({
			item: stockItems,
			onHand: sql<string>`coalesce(sum(${stockMovements.qtyMilli}), 0)`,
			moves: sql<number>`count(${stockMovements.id})::int`,
			nextExpiry: sql<string | null>`min(${stockMovements.expiresOn}) filter (where ${stockMovements.qtyRemainingMilli} > 0)`
		})
		.from(stockItems)
		.leftJoin(stockMovements, eq(stockMovements.itemId, stockItems.id))
		.where(and(eq(stockItems.hotelId, hotelId), isNull(stockItems.deletedAt)))
		.groupBy(stockItems.id)
		.orderBy(asc(stockItems.department), asc(stockItems.name));
	return rows.map((r) => {
		const onHandMilli = Number(r.onHand);
		return {
			...r.item,
			onHandMilli,
			nextExpiry: r.nextExpiry,
			hasMoves: r.moves > 0,
			isLow: r.item.reorderLevelMilli != null && onHandMilli <= r.item.reorderLevelMilli
		};
	});
}

export async function listMovements(hotelId: string, opts: { itemId?: string; limit?: number } = {}) {
	return db
		.select({
			id: stockMovements.id,
			itemId: stockMovements.itemId,
			itemName: stockItems.name,
			unit: stockItems.unit,
			type: stockMovements.type,
			qtyMilli: stockMovements.qtyMilli,
			qtyRemainingMilli: stockMovements.qtyRemainingMilli,
			expiresOn: stockMovements.expiresOn,
			packCount: stockMovements.packCount,
			packBonus: stockMovements.packBonus,
			packSizeMilli: stockMovements.packSizeMilli,
			note: stockMovements.note,
			createdAt: stockMovements.createdAt,
			byName: users.name
		})
		.from(stockMovements)
		.innerJoin(stockItems, eq(stockItems.id, stockMovements.itemId))
		.leftJoin(users, eq(users.id, stockMovements.createdBy))
		.where(and(eq(stockMovements.hotelId, hotelId), opts.itemId ? eq(stockMovements.itemId, opts.itemId) : undefined))
		.orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
		.limit(opts.limit ?? 200);
}

// ---------------------------------------------------------------------------
// Dining: recipes and automatic deduction
// ---------------------------------------------------------------------------

/** Statuses in which an order's food is the kitchen's to make — its ingredients are spoken for. */
const IN_KITCHEN: readonly string[] = ['new', 'accepted', 'preparing', 'ready', 'served'];

/** Total per stock item that an order's dishes and add-ons take, by their current recipes. */
async function orderNeeds(tx: Tx, orderId: string): Promise<Map<string, number>> {
	const live = and(isNull(stockItems.deletedAt), eq(stockItems.id, stockRecipeLines.stockItemId));
	const qty = sql<string>`sum(${stockRecipeLines.qtyMilli} * ${diningOrderItems.quantity})`;
	const dishes = await tx
		.select({ itemId: stockRecipeLines.stockItemId, qty })
		.from(diningOrderItems)
		.innerJoin(stockRecipeLines, eq(stockRecipeLines.menuItemId, diningOrderItems.menuItemId))
		.innerJoin(stockItems, live)
		.where(eq(diningOrderItems.orderId, orderId))
		.groupBy(stockRecipeLines.stockItemId);
	const addons = await tx
		.select({ itemId: stockRecipeLines.stockItemId, qty })
		.from(diningOrderItemAddons)
		.innerJoin(diningOrderItems, eq(diningOrderItems.id, diningOrderItemAddons.orderItemId))
		.innerJoin(stockRecipeLines, eq(stockRecipeLines.addonId, diningOrderItemAddons.addonId))
		.innerJoin(stockItems, live)
		.where(eq(diningOrderItems.orderId, orderId))
		.groupBy(stockRecipeLines.stockItemId);
	const needs = new Map<string, number>();
	for (const r of [...dishes, ...addons]) needs.set(r.itemId, (needs.get(r.itemId) ?? 0) + Number(r.qty));
	return needs;
}

/**
 * Brings a dining order's stock in line with its status, inside the caller's transaction. Call it
 * right after any status write; it is idempotent, so calling it where nothing changed is harmless.
 *  - Order in the kitchen and nothing deducted yet → deduct its recipes (FIFO, may go negative).
 *  - Order cancelled before any dish was started → put the ingredients back.
 *  - Cancelled after cooking began → stays deducted: that food was used.
 * An order whose dishes have no recipe simply moves no stock.
 */
export async function syncDiningOrderStock(tx: Tx, hotelId: string, orderId: string, actorId: string | null = null): Promise<void> {
	const [order] = await tx
		.select({ id: diningOrders.id, code: diningOrders.code, status: diningOrders.status })
		.from(diningOrders)
		.where(and(eq(diningOrders.id, orderId), eq(diningOrders.hotelId, hotelId)));
	if (!order) return;
	const posted = await tx
		.select({
			itemId: stockMovements.itemId,
			type: stockMovements.type,
			qtyMilli: stockMovements.qtyMilli,
			consumedFromId: stockMovements.consumedFromId
		})
		.from(stockMovements)
		.where(eq(stockMovements.diningOrderId, order.id));

	if (IN_KITCHEN.includes(order.status)) {
		if (posted.length) return;
		const needs = await orderNeeds(tx, order.id);
		// Sorted, so two orders sharing ingredients lock the items in the same order (no deadlock).
		for (const itemId of [...needs.keys()].sort()) {
			const qtyMilli = needs.get(itemId)!;
			if (qtyMilli > 0)
				await drawDown(tx, { hotelId, itemId, qtyMilli, type: 'order', note: `Order ${order.code}`, actorId, diningOrderId: order.id });
		}
		return;
	}

	if (order.status !== 'cancelled') return;
	const taken = posted.filter((p) => p.type === 'order');
	if (!taken.length || posted.some((p) => p.type === 'order_reverse')) return;
	const [cooked] = await tx
		.select({ id: diningOrderItems.id })
		.from(diningOrderItems)
		.where(and(eq(diningOrderItems.orderId, order.id), isNotNull(diningOrderItems.startedAt)))
		.limit(1);
	if (cooked) return;

	for (const itemId of [...new Set(taken.map((t) => t.itemId))].sort()) {
		await lockItem(tx, hotelId, itemId);
		for (const t of taken.filter((x) => x.itemId === itemId)) {
			const qty = -t.qtyMilli;
			const credit = batchCredit(await onHand(tx, itemId), qty);
			if (t.consumedFromId && credit > 0) {
				await tx
					.update(stockMovements)
					.set({ qtyRemainingMilli: sql`${stockMovements.qtyRemainingMilli} + ${credit}` })
					.where(eq(stockMovements.id, t.consumedFromId));
			}
			await tx.insert(stockMovements).values({
				hotelId,
				itemId,
				type: 'order_reverse',
				qtyMilli: qty,
				// Back into the batch it came from; an oversold (unbatched) part becomes a batch of its own.
				consumedFromId: t.consumedFromId,
				qtyRemainingMilli: t.consumedFromId ? null : credit,
				note: `Order ${order.code} cancelled`,
				createdBy: actorId,
				diningOrderId: order.id
			});
		}
	}
}

export interface RecipeLine {
	stockItemId: string;
	qtyMilli: number;
}

export type RecipeOwner = { menuItemId: string } | { addonId: string };

const ownedBy = (owner: RecipeOwner) =>
	'menuItemId' in owner ? eq(stockRecipeLines.menuItemId, owner.menuItemId) : eq(stockRecipeLines.addonId, owner.addonId);

export async function getRecipe(hotelId: string, owner: RecipeOwner) {
	return db
		.select({ stockItemId: stockRecipeLines.stockItemId, qtyMilli: stockRecipeLines.qtyMilli, name: stockItems.name, unit: stockItems.unit })
		.from(stockRecipeLines)
		.innerJoin(stockItems, eq(stockItems.id, stockRecipeLines.stockItemId))
		.where(and(eq(stockRecipeLines.hotelId, hotelId), ownedBy(owner), isNull(stockItems.deletedAt)))
		.orderBy(asc(stockItems.name));
}

/** Replaces a dish's (or add-on's) whole recipe. Past orders keep what they already deducted. */
export async function setRecipe(hotelId: string, owner: RecipeOwner, lines: RecipeLine[], actor: SessionUser | null): Promise<void> {
	const ids = lines.map((l) => l.stockItemId);
	if (new Set(ids).size !== ids.length) throw new StockError('An ingredient is listed twice.');
	for (const l of lines) assertQty(l.qtyMilli);
	await db.transaction(async (tx) => {
		const [owned] =
			'menuItemId' in owner
				? await tx.select({ id: diningMenuItems.id }).from(diningMenuItems).where(and(eq(diningMenuItems.id, owner.menuItemId), eq(diningMenuItems.hotelId, hotelId)))
				: await tx.select({ id: diningAddons.id }).from(diningAddons).where(and(eq(diningAddons.id, owner.addonId), eq(diningAddons.hotelId, hotelId)));
		if (!owned) throw new StockError('That dish or add-on was not found.');
		if (ids.length) {
			const mine = await tx
				.select({ id: stockItems.id })
				.from(stockItems)
				.where(and(eq(stockItems.hotelId, hotelId), inArray(stockItems.id, ids), isNull(stockItems.deletedAt)));
			if (mine.length !== ids.length) throw new StockError('An ingredient was not found.');
		}
		const where = and(eq(stockRecipeLines.hotelId, hotelId), ownedBy(owner));
		const before = await tx.select().from(stockRecipeLines).where(where);
		await tx.delete(stockRecipeLines).where(where);
		if (lines.length)
			await tx.insert(stockRecipeLines).values(lines.map((l) => ({ hotelId, ...owner, stockItemId: l.stockItemId, qtyMilli: l.qtyMilli })));
		await writeAudit({
			hotelId,
			actor,
			action: 'stock_recipe.set',
			entityType: 'menuItemId' in owner ? 'dining_menu_item' : 'dining_addon',
			entityId: 'menuItemId' in owner ? owner.menuItemId : owner.addonId,
			before: before.map((b) => ({ stockItemId: b.stockItemId, qtyMilli: b.qtyMilli })),
			after: lines,
			tx
		});
	});
}

/** Every recipe line in the hotel — small, so the menu and add-on pages take it whole and group it. */
export async function listRecipes(hotelId: string) {
	return db
		.select({ menuItemId: stockRecipeLines.menuItemId, addonId: stockRecipeLines.addonId, stockItemId: stockRecipeLines.stockItemId, qtyMilli: stockRecipeLines.qtyMilli })
		.from(stockRecipeLines)
		.innerJoin(stockItems, eq(stockItems.id, stockRecipeLines.stockItemId))
		.where(and(eq(stockRecipeLines.hotelId, hotelId), isNull(stockItems.deletedAt)));
}

/** What a recipe may use: the hotel's live, active Dining stock (not front-desk soap or linens). */
export async function listStockChoices(hotelId: string) {
	return db
		.select({ id: stockItems.id, name: stockItems.name, unit: stockItems.unit, department: stockItems.department })
		.from(stockItems)
		.where(and(eq(stockItems.hotelId, hotelId), isNull(stockItems.deletedAt), eq(stockItems.isActive, true), eq(stockItems.department, 'dining')))
		.orderBy(asc(stockItems.name));
}

// ---------------------------------------------------------------------------
// Front desk: check-in amenity kits
// ---------------------------------------------------------------------------

export interface KitLine {
	stockItemId: string;
	qtyMilli: number;
	per: 'room' | 'guest';
}

/** What a kit may hold: live, active consumables the front desk or housekeeping keeps (no linens). */
export async function listKitChoices(hotelId: string) {
	return db
		.select({ id: stockItems.id, name: stockItems.name, unit: stockItems.unit })
		.from(stockItems)
		.where(
			and(
				eq(stockItems.hotelId, hotelId),
				isNull(stockItems.deletedAt),
				eq(stockItems.isActive, true),
				eq(stockItems.kind, 'consumable'),
				inArray(stockItems.department, ['front_desk', 'housekeeping'])
			)
		)
		.orderBy(asc(stockItems.name));
}

export async function getKit(hotelId: string, roomTypeId: string): Promise<KitLine[]> {
	return db
		.select({ stockItemId: stockCheckinKitLines.stockItemId, qtyMilli: stockCheckinKitLines.qtyMilli, per: stockCheckinKitLines.per })
		.from(stockCheckinKitLines)
		.innerJoin(stockItems, eq(stockItems.id, stockCheckinKitLines.stockItemId))
		.where(and(eq(stockCheckinKitLines.hotelId, hotelId), eq(stockCheckinKitLines.roomTypeId, roomTypeId), isNull(stockItems.deletedAt)));
}

/** Replaces a room type's whole kit. */
export async function setKit(hotelId: string, roomTypeId: string, lines: KitLine[], actor: SessionUser | null): Promise<void> {
	const ids = lines.map((l) => l.stockItemId);
	if (new Set(ids).size !== ids.length) throw new StockError('An item is listed twice.');
	for (const l of lines) assertQty(l.qtyMilli);
	await db.transaction(async (tx) => {
		const [rt] = await tx.select({ id: roomTypes.id }).from(roomTypes).where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.hotelId, hotelId)));
		if (!rt) throw new StockError('That room type was not found.');
		if (ids.length) {
			const ok = await tx
				.select({ id: stockItems.id })
				.from(stockItems)
				.where(and(eq(stockItems.hotelId, hotelId), inArray(stockItems.id, ids), isNull(stockItems.deletedAt), eq(stockItems.kind, 'consumable')));
			if (ok.length !== ids.length) throw new StockError('An amenity was not found, or is a reusable item (linens are never handed out).');
		}
		const where = and(eq(stockCheckinKitLines.hotelId, hotelId), eq(stockCheckinKitLines.roomTypeId, roomTypeId));
		const before = await tx.select().from(stockCheckinKitLines).where(where);
		await tx.delete(stockCheckinKitLines).where(where);
		if (lines.length) await tx.insert(stockCheckinKitLines).values(lines.map((l) => ({ hotelId, roomTypeId, ...l })));
		await writeAudit({
			hotelId,
			actor,
			action: 'stock_kit.set',
			entityType: 'room_type',
			entityId: roomTypeId,
			before: before.map((b) => ({ stockItemId: b.stockItemId, qtyMilli: b.qtyMilli, per: b.per })),
			after: lines,
			tx
		});
	});
}

/**
 * The kit to pre-fill on a booking's check-in form: each line × rooms booked (per room) or ×
 * the booked guest count (per guest). Staff can change any quantity before checking in.
 */
export async function suggestedKit(hotelId: string, bookingId: string) {
	const [b] = await db
		.select({ roomTypeId: bookingRooms.roomTypeId, rooms: bookingRooms.quantity, guests: bookings.occupancy })
		.from(bookings)
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.where(and(eq(bookings.id, bookingId), eq(bookings.hotelId, hotelId)))
		.limit(1);
	if (!b) return [];
	const lines = await db
		.select({ stockItemId: stockItems.id, name: stockItems.name, unit: stockItems.unit, qtyMilli: stockCheckinKitLines.qtyMilli, per: stockCheckinKitLines.per })
		.from(stockCheckinKitLines)
		.innerJoin(stockItems, eq(stockItems.id, stockCheckinKitLines.stockItemId))
		.where(
			and(
				eq(stockCheckinKitLines.roomTypeId, b.roomTypeId),
				eq(stockCheckinKitLines.hotelId, hotelId),
				isNull(stockItems.deletedAt),
				eq(stockItems.isActive, true)
			)
		)
		.orderBy(asc(stockItems.name));
	return lines.map((l) => {
		const times = l.per === 'room' ? b.rooms : b.guests;
		// `perMilli` × `times` is shown beside the number, so staff can see where it came from.
		return { ...l, perMilli: l.qtyMilli, times, qtyMilli: l.qtyMilli * times };
	});
}

/**
 * Takes the amenities handed out at check-in from stock, inside `checkInBooking`'s transaction.
 * Each row carries the booking and a note with its booking code and guest name, so the
 * Movements list traces every bar of soap to a stay.
 */
export async function handOutKit(
	tx: Tx,
	input: { hotelId: string; bookingId: string; lines: { stockItemId: string; qtyMilli: number }[]; actorId: string | null }
): Promise<void> {
	const lines = input.lines.filter((l) => l.qtyMilli > 0);
	if (!lines.length) return;
	const [ref] = await tx
		.select({ orderId: orders.id, guestName: guests.fullName })
		.from(bookings)
		.innerJoin(orders, eq(orders.id, bookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.where(and(eq(bookings.id, input.bookingId), eq(bookings.hotelId, input.hotelId)));
	const note = ref ? `Check-in ${ref.orderId.slice(0, 8).toUpperCase()} · ${ref.guestName}` : 'Check-in';
	for (const l of [...lines].sort((a, b) => a.stockItemId.localeCompare(b.stockItemId))) {
		await drawDown(tx, { hotelId: input.hotelId, itemId: l.stockItemId, qtyMilli: l.qtyMilli, type: 'checkin_kit', note, actorId: input.actorId, bookingId: input.bookingId });
	}
}

// ---------------------------------------------------------------------------
// Stock counts (stock take / linen audit)
// ---------------------------------------------------------------------------

type CountRow = typeof stockCounts.$inferSelect;

async function openCountFor(tx: Tx, hotelId: string, countId: string): Promise<CountRow> {
	const [c] = await tx
		.select()
		.from(stockCounts)
		.where(and(eq(stockCounts.id, countId), eq(stockCounts.hotelId, hotelId)))
		.for('update');
	if (!c) throw new StockError('That count was not found.');
	if (c.status !== 'open') throw new StockError('This count is already finished.');
	return c;
}

/** Starts a count of every active item in `department` (null = all). One open count per hotel. */
export async function startCount(hotelId: string, department: Department | null, note: string | null, actor: SessionUser | null): Promise<string> {
	try {
		return await db.transaction(async (tx) => {
			const items = await tx
				.select({ id: stockItems.id })
				.from(stockItems)
				.where(
					and(
						eq(stockItems.hotelId, hotelId),
						isNull(stockItems.deletedAt),
						eq(stockItems.isActive, true),
						department ? eq(stockItems.department, department) : undefined
					)
				);
			if (!items.length) throw new StockError('There are no active items to count there.');
			const [c] = await tx
				.insert(stockCounts)
				.values({ hotelId, department, note: note?.trim() || null, startedBy: actor?.id ?? null })
				.returning({ id: stockCounts.id });
			await tx.insert(stockCountLines).values(items.map((i) => ({ countId: c!.id, itemId: i.id })));
			return c!.id;
		});
	} catch (e) {
		if (isDuplicateName(e)) throw new StockError('A count is already open. Finish or discard it first.');
		throw e;
	}
}

export interface CountEntry {
	itemId: string;
	countedMilli: number | null;
	reason: string | null;
}

/** Saves what has been counted so far. Lines not in `entries` are left as they are. */
export async function saveCount(hotelId: string, countId: string, entries: CountEntry[]): Promise<void> {
	for (const e of entries) {
		if (e.countedMilli != null && (!Number.isSafeInteger(e.countedMilli) || e.countedMilli < 0)) throw new StockError('A count can’t be negative.');
	}
	await db.transaction(async (tx) => {
		await openCountFor(tx, hotelId, countId);
		for (const e of entries) {
			await tx
				.update(stockCountLines)
				.set({ countedMilli: e.countedMilli, reason: e.reason?.trim() || null })
				.where(and(eq(stockCountLines.countId, countId), eq(stockCountLines.itemId, e.itemId)));
		}
	});
}

/**
 * Posts the count: for every counted line, the difference from on hand *right now* (so sales
 * during a long count aren't double-counted) becomes an adjustment tagged with the count. A line
 * that differs must have a reason; if any lacks one nothing is posted. Uncounted lines are skipped.
 */
export async function finishCount(hotelId: string, countId: string, actor: SessionUser | null): Promise<{ adjusted: number; skipped: number }> {
	return db.transaction(async (tx) => {
		await openCountFor(tx, hotelId, countId);
		const lines = await tx.select().from(stockCountLines).where(eq(stockCountLines.countId, countId));
		const counted = lines.filter((l) => l.countedMilli != null).sort((a, b) => a.itemId.localeCompare(b.itemId));
		if (!counted.length) throw new StockError('Nothing has been counted yet.');
		const missingReason: string[] = [];
		let adjusted = 0;
		for (const l of counted) {
			const { name, before, diff } = await postCount(tx, {
				hotelId,
				itemId: l.itemId,
				countedMilli: l.countedMilli!,
				note: l.reason ? `Stock count: ${l.reason}` : 'Stock count',
				actorId: actor?.id ?? null,
				countId
			});
			if (diff !== 0 && !l.reason) missingReason.push(name);
			if (diff !== 0) adjusted++;
			await tx.update(stockCountLines).set({ expectedMilli: before, varianceMilli: diff }).where(eq(stockCountLines.id, l.id));
		}
		// Thrown inside the transaction, so every adjustment above rolls back with it.
		if (missingReason.length) throw new StockError(`Add a remark for the difference on: ${missingReason.join(", ")}.`);
		await tx.update(stockCounts).set({ status: 'finished', finishedBy: actor?.id ?? null, finishedAt: new Date() }).where(eq(stockCounts.id, countId));
		await writeAudit({ hotelId, actor, action: 'stock_count.finish', entityType: 'stock_count', entityId: countId, after: { adjusted, skipped: lines.length - counted.length }, tx });
		return { adjusted, skipped: lines.length - counted.length };
	});
}

/** Throws an open count away; nothing was posted, so nothing to undo. */
export async function discardCount(hotelId: string, countId: string, actor: SessionUser | null): Promise<void> {
	await db.transaction(async (tx) => {
		await openCountFor(tx, hotelId, countId);
		await tx.delete(stockCounts).where(eq(stockCounts.id, countId));
		await writeAudit({ hotelId, actor, action: 'stock_count.discard', entityType: 'stock_count', entityId: countId, tx });
	});
}

export async function listCounts(hotelId: string, onlyId?: string) {
	// Correlated subqueries name the outer table in full: Drizzle writes a column of a single-table
	// select unqualified, and inside a subquery a bare "id" would bind to the subquery's own row.
	const starter = sql<string | null>`(select u.name from users u where u.id = stock_counts.started_by)`;
	const finisher = sql<string | null>`(select u.name from users u where u.id = stock_counts.finished_by)`;
	return db
		.select({
			id: stockCounts.id,
			department: stockCounts.department,
			status: stockCounts.status,
			note: stockCounts.note,
			startedAt: stockCounts.startedAt,
			finishedAt: stockCounts.finishedAt,
			startedByName: starter,
			finishedByName: finisher,
			lines: sql<number>`(select count(*)::int from stock_count_lines l where l.count_id = stock_counts.id)`,
			adjusted: sql<number>`(select count(*)::int from stock_count_lines l where l.count_id = stock_counts.id and l.variance_milli <> 0)`
		})
		.from(stockCounts)
		.where(and(eq(stockCounts.hotelId, hotelId), onlyId ? eq(stockCounts.id, onlyId) : undefined))
		.orderBy(desc(stockCounts.startedAt))
		.limit(100);
}

/** One count with its lines; while open, each line also carries live on hand. */
export async function getCount(hotelId: string, countId: string) {
	const [count] = await listCounts(hotelId, countId);
	if (!count) return null;
	const lines = await db
		.select({
			itemId: stockItems.id,
			name: stockItems.name,
			unit: stockItems.unit,
			kind: stockItems.kind,
			department: stockItems.department,
			countedMilli: stockCountLines.countedMilli,
			reason: stockCountLines.reason,
			expectedMilli: stockCountLines.expectedMilli,
			varianceMilli: stockCountLines.varianceMilli,
			onHandMilli: sql<string>`(select coalesce(sum(m.qty_milli), 0) from stock_movements m where m.item_id = stock_items.id)`
		})
		.from(stockCountLines)
		.innerJoin(stockItems, eq(stockItems.id, stockCountLines.itemId))
		.where(eq(stockCountLines.countId, countId))
		.orderBy(asc(stockItems.department), asc(stockItems.name));
	return { count, lines: lines.map((l) => ({ ...l, onHandMilli: Number(l.onHandMilli) })) };
}

/** Active items at or below their reorder level, or below zero — the sidebar's Inventory badge. */
export async function countLowStock(hotelId: string): Promise<number> {
	const [r] = await db.execute<{ n: number }>(sql`
		select count(*)::int as n from (
			select i.id, i.reorder_level_milli as lvl, coalesce(sum(m.qty_milli), 0) as qty
			from stock_items i left join stock_movements m on m.item_id = i.id
			where i.hotel_id = ${hotelId} and i.deleted_at is null and i.is_active
			group by i.id
		) x
		where x.qty < 0 or (x.lvl is not null and x.qty <= x.lvl)`);
	return Number(r?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Restock: one supplier receipt → stock batches + one Finance expense
// ---------------------------------------------------------------------------

export interface RestockLine {
	itemId: string;
	qtyMilli: number;
	expiresOn?: string | null;
}

export interface RestockInput {
	hotelId: string;
	receiptDate: string;
	vendorId: string | null;
	vendorName: string | null;
	receiptNo: string | null;
	totalCentavos: number;
	isVatable: boolean;
	categoryId: string;
	source: 'hotel' | 'dining';
	attachmentUrl: string | null;
	note: string | null;
	lines: RestockLine[];
	actor: SessionUser | null;
}

/**
 * Encodes a supplier receipt: every line becomes a FIFO batch tagged with the restock, and the
 * receipt total becomes one expense (unpaid — Finance pays it) in the same transaction, so stock
 * and money can never disagree. Returns the restock id.
 */
export async function createRestock(input: RestockInput): Promise<string> {
	if (!input.lines.length) throw new StockError('Add at least one item from the receipt.');
	const ids = input.lines.map((l) => l.itemId);
	if (new Set(ids).size !== ids.length) throw new StockError('An item is listed twice. Put its whole quantity on one line.');
	for (const l of input.lines) assertQty(l.qtyMilli);
	if (!Number.isSafeInteger(input.totalCentavos) || input.totalCentavos <= 0) throw new StockError('Enter the receipt total.');
	const supplier = input.vendorName?.trim() || null;

	return db.transaction(async (tx) => {
		const items = await tx
			.select({ id: stockItems.id, name: stockItems.name, unit: stockItems.unit, isActive: stockItems.isActive })
			.from(stockItems)
			.where(and(eq(stockItems.hotelId, input.hotelId), inArray(stockItems.id, ids), isNull(stockItems.deletedAt)));
		if (items.length !== ids.length) throw new StockError('An item on the receipt was not found.');
		const inactive = items.filter((i) => !i.isActive);
		if (inactive.length) throw new StockError(`${inactive.map((i) => i.name).join(', ')} is inactive. Turn it back on first.`);
		const byId = new Map(items.map((i) => [i.id, i]));

		const [r] = await tx
			.insert(stockRestocks)
			.values({
				hotelId: input.hotelId,
				receiptDate: input.receiptDate,
				vendorId: input.vendorId,
				vendorName: input.vendorId ? null : supplier,
				receiptNo: input.receiptNo?.trim() || null,
				totalCentavos: input.totalCentavos,
				attachmentUrl: input.attachmentUrl,
				note: input.note?.trim() || null,
				createdBy: input.actor?.id ?? null
			})
			.returning({ id: stockRestocks.id });

		const label = input.receiptNo?.trim() ? `Receipt ${input.receiptNo.trim()}` : 'Restock';
		for (const l of [...input.lines].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
			await lockItem(tx, input.hotelId, l.itemId);
			const before = await onHand(tx, l.itemId);
			await tx.insert(stockMovements).values({
				hotelId: input.hotelId,
				itemId: l.itemId,
				type: 'restock',
				qtyMilli: l.qtyMilli,
				qtyRemainingMilli: batchCredit(before, l.qtyMilli),
				expiresOn: l.expiresOn || null,
				note: label,
				restockId: r!.id,
				createdBy: input.actor?.id ?? null
			});
		}

		const listed = input.lines.map((l) => `${byId.get(l.itemId)!.name} ${formatQty(l.qtyMilli, byId.get(l.itemId)!.unit)}`).join('; ');
		const { expenseId } = await createExpense({
			hotelId: input.hotelId,
			expenseDate: input.receiptDate,
			categoryId: input.categoryId,
			vendorId: input.vendorId,
			vendorName: input.vendorId ? null : supplier,
			description: `Stock restock${supplier ? ` — ${supplier}` : ''}`.slice(0, 300),
			source: input.source,
			vendorInvoiceNo: input.receiptNo?.trim() || null,
			grossCentavos: input.totalCentavos,
			isVatable: input.isVatable,
			notes: `From Inventory → Restock: ${listed}`.slice(0, 1000),
			attachmentUrl: input.attachmentUrl,
			actor: input.actor,
			tx
		});
		await tx.update(stockRestocks).set({ expenseId }).where(eq(stockRestocks.id, r!.id));
		return r!.id;
	});
}

/**
 * Voids a wrongly-encoded receipt: takes its batches back out and voids its expense, together.
 * Refused once any of the delivery has been used (correct the count instead) or once Finance has
 * paid the expense (the payment has to be undone in Finance first).
 */
export async function voidRestock(hotelId: string, restockId: string, reason: string, actor: SessionUser | null): Promise<void> {
	const why = reason.trim();
	if (!why) throw new StockError('Say why this receipt is being voided.');
	await db.transaction(async (tx) => {
		const [r] = await tx
			.select()
			.from(stockRestocks)
			.where(and(eq(stockRestocks.id, restockId), eq(stockRestocks.hotelId, hotelId)))
			.for('update');
		if (!r) throw new StockError('That receipt was not found.');
		if (r.voidedAt) throw new StockError('This receipt is already voided.');
		if (r.expenseId) {
			const [e] = await tx.select({ status: expenses.status }).from(expenses).where(eq(expenses.id, r.expenseId));
			if (e?.status === 'paid') throw new StockError('Finance has already paid this receipt. Ask Finance to void the expense first.');
		}

		const batches = await tx
			.select({ id: stockMovements.id, itemId: stockMovements.itemId, qty: stockMovements.qtyMilli, left: stockMovements.qtyRemainingMilli })
			.from(stockMovements)
			.where(and(eq(stockMovements.restockId, restockId), eq(stockMovements.type, 'restock')))
			.orderBy(asc(stockMovements.itemId));
		const used: string[] = [];
		for (const b of batches) {
			const item = await lockItem(tx, hotelId, b.itemId);
			const [fresh] = await tx.select({ left: stockMovements.qtyRemainingMilli }).from(stockMovements).where(eq(stockMovements.id, b.id));
			if ((fresh?.left ?? 0) !== b.qty) used.push(item.name);
		}
		if (used.length) throw new StockError(`Some of this delivery is already used (${used.join(', ')}). Correct the count instead of voiding.`);

		for (const b of batches) {
			await tx.update(stockMovements).set({ qtyRemainingMilli: 0 }).where(eq(stockMovements.id, b.id));
			await tx.insert(stockMovements).values({
				hotelId,
				itemId: b.itemId,
				type: 'restock_void',
				qtyMilli: -b.qty,
				consumedFromId: b.id,
				restockId,
				note: `Receipt voided: ${why}`,
				createdBy: actor?.id ?? null
			});
		}
		if (r.expenseId) {
			const [e] = await tx.select({ status: expenses.status }).from(expenses).where(eq(expenses.id, r.expenseId));
			if (e && e.status !== 'void') await voidExpense(hotelId, r.expenseId, `Restock voided: ${why}`, actor, tx);
		}
		await tx.update(stockRestocks).set({ voidedAt: new Date(), voidedBy: actor?.id ?? null, voidReason: why }).where(eq(stockRestocks.id, restockId));
		await writeAudit({ hotelId, actor, action: 'stock_restock.void', entityType: 'stock_restock', entityId: restockId, after: { reason: why }, tx });
	});
}

const restockSupplier = sql<string | null>`coalesce((select v.name from vendors v where v.id = stock_restocks.vendor_id), stock_restocks.vendor_name)`;

export async function listRestocks(hotelId: string, onlyId?: string) {
	return db
		.select({
			id: stockRestocks.id,
			receiptDate: stockRestocks.receiptDate,
			supplier: restockSupplier,
			receiptNo: stockRestocks.receiptNo,
			totalCentavos: stockRestocks.totalCentavos,
			attachmentUrl: stockRestocks.attachmentUrl,
			note: stockRestocks.note,
			expenseId: stockRestocks.expenseId,
			expenseStatus: sql<string | null>`(select e.status from expenses e where e.id = stock_restocks.expense_id)`,
			createdAt: stockRestocks.createdAt,
			createdByName: sql<string | null>`(select u.name from users u where u.id = stock_restocks.created_by)`,
			voidedAt: stockRestocks.voidedAt,
			voidReason: stockRestocks.voidReason,
			lines: sql<number>`(select count(*)::int from stock_movements m where m.restock_id = stock_restocks.id and m.type = 'restock')`
		})
		.from(stockRestocks)
		.where(and(eq(stockRestocks.hotelId, hotelId), onlyId ? eq(stockRestocks.id, onlyId) : undefined))
		.orderBy(desc(stockRestocks.receiptDate), desc(stockRestocks.createdAt))
		.limit(200);
}

export async function getRestock(hotelId: string, restockId: string) {
	const [restock] = await listRestocks(hotelId, restockId);
	if (!restock) return null;
	const lines = await db
		.select({
			itemId: stockItems.id,
			name: stockItems.name,
			unit: stockItems.unit,
			qtyMilli: stockMovements.qtyMilli,
			remainingMilli: stockMovements.qtyRemainingMilli,
			expiresOn: stockMovements.expiresOn
		})
		.from(stockMovements)
		.innerJoin(stockItems, eq(stockItems.id, stockMovements.itemId))
		.where(and(eq(stockMovements.restockId, restockId), eq(stockMovements.type, 'restock')))
		.orderBy(asc(stockItems.name));
	return { restock, lines };
}

/** The restock an expense came from, if any — Finance links back to it. */
export async function restockForExpense(hotelId: string, expenseId: string) {
	const [r] = await db
		.select({ id: stockRestocks.id, receiptNo: stockRestocks.receiptNo })
		.from(stockRestocks)
		.where(and(eq(stockRestocks.hotelId, hotelId), eq(stockRestocks.expenseId, expenseId)));
	return r ?? null;
}
