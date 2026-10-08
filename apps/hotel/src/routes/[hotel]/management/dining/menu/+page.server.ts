import { fail } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	diningAddonGroups,
	diningItems,
	diningMenuCategories,
	diningMenuItemAddonGroups,
	diningMenuItems,
	diningStations
} from '$lib/server/db/schema/index';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { deleteUploadIfOwned, saveResizedImage, UploadValidationError } from '$lib/server/uploads';
import { listStations, loadVenueMenu, venueBelongsToHotel } from '$lib/server/dining-menu';
import { friendlyIssue, moneyPhp, recordId } from '$lib/rate-validation';
import type { RequestEvent } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotelId = locals.hotel!.id;

	const venues = await db
		.select({ id: diningItems.id, title: diningItems.title, isActive: diningItems.isActive })
		.from(diningItems)
		.where(eq(diningItems.hotelId, hotelId))
		.orderBy(asc(diningItems.sortOrder), asc(diningItems.title));

	const requested = url.searchParams.get('venue');
	const venue = venues.find((v) => v.id === requested) ?? venues[0] ?? null;
	const menu = venue ? await loadVenueMenu(hotelId, venue.id) : null;
	const stations = await listStations(hotelId);

	return { venues, venue, menu, stations };
};

/** Menu edits need `dining:manage` (hotel admins also qualify through `hotel:admin`). */
function requireManage(event: RequestEvent) {
	const { user, role } = event.locals;
	if (user?.isPlatformAdmin) return;
	if (role && roleCan(role.capabilities, 'hotel:admin')) return;
	requireCap(user, role, 'dining:manage');
}

const toCentavos = (php: number) => Math.round(php * 100);

const categorySchema = z.object({
	diningItemId: recordId(),
	name: z.string().trim().min(1, 'Give the category a name.').max(80)
});

const itemSchema = z.object({
	diningItemId: recordId(),
	name: z.string().trim().min(1, 'Give the item a name.').max(120),
	description: z.string().trim().max(500).optional(),
	pricePhp: moneyPhp(),
	categoryId: z.string().uuid().optional(),
	stationId: z.string().uuid().optional(),
	sortOrder: z.coerce.number().int().min(0).max(100000)
});

export const actions: Actions = {
	createCategory: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = categorySchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) {
			return fail(400, { error: friendlyIssue(parsed.error, 'Give the category a name.') });
		}
		const d = parsed.data;
		if (!(await venueBelongsToHotel(hotelId, d.diningItemId))) {
			return fail(404, { error: 'Venue not found.' });
		}

		const [row] = await db
			.insert(diningMenuCategories)
			.values({ hotelId, diningItemId: d.diningItemId, name: d.name })
			.returning({ id: diningMenuCategories.id });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_menu_category.create',
			entityType: 'dining_menu_category',
			entityId: row!.id,
			after: d
		});
		return { ok: `Added category "${d.name}".` };
	},

	renameCategory: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = categorySchema
			.omit({ diningItemId: true })
			.extend({ categoryId: recordId() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) {
			return fail(400, { error: friendlyIssue(parsed.error, 'Give the category a name.') });
		}

		const updated = await db
			.update(diningMenuCategories)
			.set({ name: parsed.data.name, updatedAt: new Date() })
			.where(
				and(
					eq(diningMenuCategories.id, parsed.data.categoryId),
					eq(diningMenuCategories.hotelId, hotelId)
				)
			)
			.returning({ id: diningMenuCategories.id });
		if (updated.length === 0) return fail(404, { error: 'That category could not be found.' });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_menu_category.update',
			entityType: 'dining_menu_category',
			entityId: parsed.data.categoryId,
			after: { name: parsed.data.name }
		});
		return { ok: 'Category renamed.' };
	},

	deleteCategory: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ categoryId: recordId() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'That category could not be found.' });

		// Items fall back to "Uncategorised" (FK is ON DELETE SET NULL).
		const deleted = await db
			.delete(diningMenuCategories)
			.where(
				and(
					eq(diningMenuCategories.id, parsed.data.categoryId),
					eq(diningMenuCategories.hotelId, hotelId)
				)
			)
			.returning({ id: diningMenuCategories.id });
		if (deleted.length === 0) return fail(404, { error: 'That category could not be found.' });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_menu_category.delete',
			entityType: 'dining_menu_category',
			entityId: parsed.data.categoryId
		});
		return { ok: 'Category deleted. Its items are now uncategorised.' };
	},

	/** Create when `itemId` is absent, update otherwise. */
	saveItem: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const form = await event.request.formData();
		const raw = Object.fromEntries(form);
		const parsed = itemSchema.safeParse({
			...raw,
			categoryId: raw.categoryId && raw.categoryId !== 'none' ? raw.categoryId : undefined,
			description: raw.description || undefined,
			stationId: raw.stationId && raw.stationId !== 'none' ? raw.stationId : undefined,
			sortOrder: raw.sortOrder || '0'
		});
		if (!parsed.success) {
			return fail(400, { error: friendlyIssue(parsed.error, 'Check the item details and try again.') });
		}
		const d = parsed.data;
		const itemId = raw.itemId ? String(raw.itemId) : null;
		if (itemId && !z.string().uuid().safeParse(itemId).success) {
			return fail(400, { error: 'That item could not be found.' });
		}
		if (!(await venueBelongsToHotel(hotelId, d.diningItemId))) {
			return fail(404, { error: 'Venue not found.' });
		}

		if (d.categoryId) {
			const [cat] = await db
				.select({ id: diningMenuCategories.id })
				.from(diningMenuCategories)
				.where(
					and(
						eq(diningMenuCategories.id, d.categoryId),
						eq(diningMenuCategories.hotelId, hotelId),
						eq(diningMenuCategories.diningItemId, d.diningItemId)
					)
				)
				.limit(1);
			if (!cat) return fail(400, { error: 'Pick a category from this venue.' });
		}

		if (d.stationId) {
			const [st] = await db
				.select({ id: diningStations.id })
				.from(diningStations)
				.where(and(eq(diningStations.id, d.stationId), eq(diningStations.hotelId, hotelId)))
				.limit(1);
			if (!st) return fail(400, { error: 'Pick a station from your list.' });
		}

		const groupIds = [...new Set(form.getAll('addonGroupIds').map(String))].filter(
			(g) => z.string().uuid().safeParse(g).success
		);
		if (groupIds.length) {
			const valid = await db
				.select({ id: diningAddonGroups.id })
				.from(diningAddonGroups)
				.where(
					and(
						inArray(diningAddonGroups.id, groupIds),
						eq(diningAddonGroups.hotelId, hotelId),
						eq(diningAddonGroups.diningItemId, d.diningItemId)
					)
				);
			if (valid.length !== groupIds.length) {
				return fail(400, { error: 'Pick add-on groups from this venue.' });
			}
		}

		// Image: a new file replaces the old one; "remove" clears it; otherwise keep as is.
		let previousImage: string | null = null;
		if (itemId) {
			const [existing] = await db
				.select({ imageUrl: diningMenuItems.imageUrl })
				.from(diningMenuItems)
				.where(and(eq(diningMenuItems.id, itemId), eq(diningMenuItems.hotelId, hotelId)))
				.limit(1);
			previousImage = existing?.imageUrl ?? null;
		}
		let imageUrl = previousImage;
		const imageFile = form.get('image');
		if (imageFile instanceof File && imageFile.size > 0) {
			try {
				imageUrl = await saveResizedImage(hotelId, imageFile);
			} catch (e) {
				if (e instanceof UploadValidationError) return fail(400, { error: e.message });
				throw e;
			}
		} else if (raw.removeImage === 'on') {
			imageUrl = null;
		}

		const values = {
			imageUrl,
			name: d.name,
			description: d.description ?? null,
			priceCentavos: toCentavos(d.pricePhp),
			categoryId: d.categoryId ?? null,
			stationId: d.stationId ?? null,
			taxable: raw.taxable === 'on',
			isActive: raw.isActive === 'on',
			sortOrder: d.sortOrder
		};

		const savedId = await db.transaction(async (tx) => {
			let id = itemId;
			if (id) {
				const updated = await tx
					.update(diningMenuItems)
					.set({ ...values, updatedAt: new Date() })
					.where(
						and(
							eq(diningMenuItems.id, id),
							eq(diningMenuItems.hotelId, hotelId),
							eq(diningMenuItems.diningItemId, d.diningItemId),
							isNull(diningMenuItems.deletedAt)
						)
					)
					.returning({ id: diningMenuItems.id });
				if (updated.length === 0) return null;
			} else {
				const [row] = await tx
					.insert(diningMenuItems)
					.values({ hotelId, diningItemId: d.diningItemId, ...values })
					.returning({ id: diningMenuItems.id });
				id = row!.id;
			}
			const menuItemId = id;
			await tx
				.delete(diningMenuItemAddonGroups)
				.where(eq(diningMenuItemAddonGroups.menuItemId, menuItemId));
			if (groupIds.length) {
				await tx
					.insert(diningMenuItemAddonGroups)
					.values(groupIds.map((addonGroupId) => ({ menuItemId, addonGroupId })));
			}
			return menuItemId;
		});
		if (!savedId) {
			if (imageUrl && imageUrl !== previousImage) await deleteUploadIfOwned(imageUrl);
			return fail(404, { error: 'That item could not be found.' });
		}
		if (previousImage && previousImage !== imageUrl) await deleteUploadIfOwned(previousImage);

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: itemId ? 'dining_menu_item.update' : 'dining_menu_item.create',
			entityType: 'dining_menu_item',
			entityId: savedId,
			after: { ...values, addonGroupIds: groupIds }
		});
		return { ok: itemId ? `Updated "${d.name}".` : `Added "${d.name}".` };
	},

	/** The "sold out today" switch. Staff running service need this without full manage rights. */
	toggleAvailable: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ itemId: recordId(), isAvailable: z.enum(['true', 'false']) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'That item could not be found.' });

		const updated = await db
			.update(diningMenuItems)
			.set({ isAvailable: parsed.data.isAvailable === 'true', updatedAt: new Date() })
			.where(
				and(
					eq(diningMenuItems.id, parsed.data.itemId),
					eq(diningMenuItems.hotelId, hotelId),
					isNull(diningMenuItems.deletedAt)
				)
			)
			.returning({ name: diningMenuItems.name });
		if (updated.length === 0) return fail(404, { error: 'That item could not be found.' });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_menu_item.availability',
			entityType: 'dining_menu_item',
			entityId: parsed.data.itemId,
			after: { isAvailable: parsed.data.isAvailable === 'true' }
		});
		return {
			ok:
				parsed.data.isAvailable === 'true'
					? `"${updated[0]!.name}" is available again.`
					: `"${updated[0]!.name}" marked sold out.`
		};
	},

	deleteItem: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ itemId: recordId() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'That item could not be found.' });

		// Soft delete: past orders will snapshot the dish, but keeping the row costs nothing.
		const updated = await db
			.update(diningMenuItems)
			.set({ deletedAt: new Date(), updatedAt: new Date() })
			.where(
				and(
					eq(diningMenuItems.id, parsed.data.itemId),
					eq(diningMenuItems.hotelId, hotelId),
					isNull(diningMenuItems.deletedAt)
				)
			)
			.returning({ name: diningMenuItems.name });
		if (updated.length === 0) return fail(404, { error: 'That item could not be found.' });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_menu_item.delete',
			entityType: 'dining_menu_item',
			entityId: parsed.data.itemId
		});
		return { ok: `Removed "${updated[0]!.name}" from the menu.` };
	}
};
