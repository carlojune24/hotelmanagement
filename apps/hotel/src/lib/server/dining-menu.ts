import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
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
