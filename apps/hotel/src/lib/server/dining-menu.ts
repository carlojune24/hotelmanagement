import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { db } from './db/index';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';
import {
	diningAddonGroups,
	diningAddons,
	diningItems,
	diningMenuCategories,
	diningMenuItemAddonGroups,
	diningMenuItems,
	diningOrderItems,
	diningOrders,
	diningStations,
	type DiningAddon,
	type DiningAddonGroup,
	type DiningMenuCategory,
	type DiningMenuItem,
	type DiningStation
} from './db/schema/index';

export interface MenuItemWithAddons extends DiningMenuItem {
	addonGroupIds: string[];
}

export interface AddonGroupWithAddons extends DiningAddonGroup {
	addons: DiningAddon[];
}

export interface VenueMenu {
	categories: DiningMenuCategory[];
	items: MenuItemWithAddons[];
	groups: AddonGroupWithAddons[];
}

/** The hotel's prep stations, in display order. */
export async function listStations(hotelId: string): Promise<DiningStation[]> {
	return db
		.select()
		.from(diningStations)
		.where(eq(diningStations.hotelId, hotelId))
		.orderBy(asc(diningStations.sortOrder), asc(diningStations.name));
}

/** The name of the station a hotel gets when it has none, so the dish form always has one to pick. */
export const DEFAULT_STATION_NAME = 'Kitchen';

/**
 * The hotel's stations, creating a single default one when it has none. A dish must belong to a
 * station, so a hotel that has not set any up yet still needs something to choose. Idempotent
 * (the name is unique per hotel) and safe to call concurrently.
 */
export async function ensureDefaultStation(hotelId: string): Promise<DiningStation[]> {
	const existing = await listStations(hotelId);
	if (existing.length > 0) return existing;
	await db
		.insert(diningStations)
		.values({ hotelId, name: DEFAULT_STATION_NAME })
		.onConflictDoNothing({ target: [diningStations.hotelId, diningStations.name] });
	return listStations(hotelId);
}

/** A station change that cannot go ahead; the message is safe to show staff. */
export class StationError extends Error {}

/**
 * Deletes a station. Its dishes are moved to `moveToStationId` first (every dish needs a station),
 * and so are the lines of orders still being made, so the kitchen board does not grow a stray lane
 * for the old name. Finished and cancelled orders keep the name they were made at.
 */
export async function deleteStationMovingDishes(args: {
	hotelId: string;
	stationId: string;
	moveToStationId?: string | null;
	actor?: SessionUser | null;
}): Promise<{ name: string; movedDishes: number; movedTo: string | null }> {
	return db.transaction(async (tx) => {
		const [station] = await tx
			.select({ id: diningStations.id, name: diningStations.name })
			.from(diningStations)
			.where(and(eq(diningStations.id, args.stationId), eq(diningStations.hotelId, args.hotelId)))
			.for('update');
		if (!station) throw new StationError('Station not found.');

		const dishes = await tx
			.select({ id: diningMenuItems.id })
			.from(diningMenuItems)
			.where(and(eq(diningMenuItems.hotelId, args.hotelId), eq(diningMenuItems.stationId, station.id)));

		let target: { id: string; name: string } | null = null;
		if (dishes.length > 0) {
			if (!args.moveToStationId) throw new StationError('Choose a station to move its dishes to.');
			if (args.moveToStationId === station.id) throw new StationError('Choose a different station to move its dishes to.');
			const [dest] = await tx
				.select({ id: diningStations.id, name: diningStations.name })
				.from(diningStations)
				.where(and(eq(diningStations.id, args.moveToStationId), eq(diningStations.hotelId, args.hotelId)))
				.for('update');
			if (!dest) throw new StationError('Choose a station from your list.');
			target = dest;

			await tx
				.update(diningMenuItems)
				.set({ stationId: target.id, updatedAt: new Date() })
				.where(and(eq(diningMenuItems.hotelId, args.hotelId), eq(diningMenuItems.stationId, station.id)));

			await tx
				.update(diningOrderItems)
				.set({ stationId: target.id, stationName: target.name })
				.where(
					and(
						eq(diningOrderItems.stationId, station.id),
						inArray(
							diningOrderItems.orderId,
							tx
								.select({ id: diningOrders.id })
								.from(diningOrders)
								.where(and(eq(diningOrders.hotelId, args.hotelId), notInArray(diningOrders.status, ['served', 'cancelled'])))
						)
					)
				);
		}

		await tx.delete(diningStations).where(eq(diningStations.id, station.id));
		await writeAudit({
			hotelId: args.hotelId,
			actor: args.actor ?? null,
			action: 'dining_station.delete',
			entityType: 'dining_station',
			entityId: station.id,
			before: { name: station.name },
			after: { movedDishes: dishes.length, movedTo: target?.name ?? null }
		});
		return { name: station.name, movedDishes: dishes.length, movedTo: target?.name ?? null };
	});
}

/** True when the venue exists and belongs to the hotel — every menu write checks this first
 *  so a forged `diningItemId` can never reach another tenant's rows. */
export async function venueBelongsToHotel(hotelId: string, diningItemId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: diningItems.id })
		.from(diningItems)
		.where(and(eq(diningItems.id, diningItemId), eq(diningItems.hotelId, hotelId)))
		.limit(1);
	return !!row;
}

/** One venue's full menu for the staff editor: categories, non-deleted items (with the
 *  add-on groups each offers), and the venue's add-on groups with their add-ons. */
export async function loadVenueMenu(hotelId: string, diningItemId: string): Promise<VenueMenu> {
	const [categories, items, groups] = await Promise.all([
		db
			.select()
			.from(diningMenuCategories)
			.where(
				and(eq(diningMenuCategories.hotelId, hotelId), eq(diningMenuCategories.diningItemId, diningItemId))
			)
			.orderBy(asc(diningMenuCategories.sortOrder), asc(diningMenuCategories.name)),
		db
			.select()
			.from(diningMenuItems)
			.where(
				and(
					eq(diningMenuItems.hotelId, hotelId),
					eq(diningMenuItems.diningItemId, diningItemId),
					isNull(diningMenuItems.deletedAt)
				)
			)
			.orderBy(asc(diningMenuItems.sortOrder), asc(diningMenuItems.name)),
		db
			.select()
			.from(diningAddonGroups)
			.where(and(eq(diningAddonGroups.hotelId, hotelId), eq(diningAddonGroups.diningItemId, diningItemId)))
			.orderBy(asc(diningAddonGroups.sortOrder), asc(diningAddonGroups.name))
	]);

	const itemIds = items.map((i) => i.id);
	const groupIds = groups.map((g) => g.id);
	const [links, addons] = await Promise.all([
		itemIds.length
			? db
					.select()
					.from(diningMenuItemAddonGroups)
					.where(inArray(diningMenuItemAddonGroups.menuItemId, itemIds))
			: Promise.resolve([]),
		groupIds.length
			? db
					.select()
					.from(diningAddons)
					.where(and(eq(diningAddons.hotelId, hotelId), inArray(diningAddons.groupId, groupIds)))
					.orderBy(asc(diningAddons.sortOrder), asc(diningAddons.name))
			: Promise.resolve([])
	]);

	return {
		categories,
		items: items.map((i) => ({
			...i,
			addonGroupIds: links.filter((l) => l.menuItemId === i.id).map((l) => l.addonGroupId)
		})),
		groups: groups.map((g) => ({ ...g, addons: addons.filter((a) => a.groupId === g.id) }))
	};
}

export interface PublicMenuItem {
	id: string;
	name: string;
	description: string | null;
	imageUrl: string | null;
	priceCentavos: number;
	isAvailable: boolean;
	categoryId: string | null;
	hasAddons: boolean;
}

export interface PublicVenueMenu {
	categories: { id: string; name: string }[];
	items: PublicMenuItem[];
}

/** Read-only menus for the public Dining page, keyed by venue id. Active, non-deleted
 *  items only; a venue with no items gets no entry. */
export async function listPublicMenus(hotelId: string): Promise<Record<string, PublicVenueMenu>> {
	const [categories, items, links] = await Promise.all([
		db
			.select()
			.from(diningMenuCategories)
			.where(eq(diningMenuCategories.hotelId, hotelId))
			.orderBy(asc(diningMenuCategories.sortOrder), asc(diningMenuCategories.name)),
		db
			.select()
			.from(diningMenuItems)
			.where(
				and(
					eq(diningMenuItems.hotelId, hotelId),
					eq(diningMenuItems.isActive, true),
					isNull(diningMenuItems.deletedAt)
				)
			)
			.orderBy(asc(diningMenuItems.sortOrder), asc(diningMenuItems.name)),
		db
			.select({ menuItemId: diningMenuItemAddonGroups.menuItemId })
			.from(diningMenuItemAddonGroups)
			.innerJoin(diningMenuItems, eq(diningMenuItems.id, diningMenuItemAddonGroups.menuItemId))
			.where(eq(diningMenuItems.hotelId, hotelId))
	]);

	const withAddons = new Set(links.map((l) => l.menuItemId));
	const out: Record<string, PublicVenueMenu> = {};
	for (const item of items) {
		const venue = (out[item.diningItemId] ??= { categories: [], items: [] });
		venue.items.push({
			id: item.id,
			name: item.name,
			description: item.description,
			imageUrl: item.imageUrl,
			priceCentavos: item.priceCentavos,
			isAvailable: item.isAvailable,
			categoryId: item.categoryId,
			hasAddons: withAddons.has(item.id)
		});
	}
	for (const [venueId, venue] of Object.entries(out)) {
		const used = new Set(venue.items.map((i) => i.categoryId));
		venue.categories = categories
			.filter((c) => c.diningItemId === venueId && used.has(c.id))
			.map((c) => ({ id: c.id, name: c.name }));
	}
	return out;
}

/** Flips a dish between Available and Sold out for today. Returns the dish name, or null when it
 *  isn't this hotel's. Shared by the Dining menu and the Kitchen's Sold out page. */
export async function setItemAvailability(args: {
	hotelId: string;
	itemId: string;
	isAvailable: boolean;
	actor: SessionUser | null;
}): Promise<string | null> {
	const updated = await db
		.update(diningMenuItems)
		.set({ isAvailable: args.isAvailable, updatedAt: new Date() })
		.where(
			and(
				eq(diningMenuItems.id, args.itemId),
				eq(diningMenuItems.hotelId, args.hotelId),
				isNull(diningMenuItems.deletedAt)
			)
		)
		.returning({ name: diningMenuItems.name });
	if (updated.length === 0) return null;
	await writeAudit({
		hotelId: args.hotelId,
		actor: args.actor,
		action: 'dining_menu_item.availability',
		entityType: 'dining_menu_item',
		entityId: args.itemId,
		after: { isAvailable: args.isAvailable }
	});
	return updated[0]!.name;
}
