import { fail } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { amenityItems, folioCharges } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;

	const items = await db
		.select()
		.from(amenityItems)
		.where(eq(amenityItems.hotelId, hotelId))
		.orderBy(asc(amenityItems.sortOrder), asc(amenityItems.name));

	// Distinct categories already in use — offered as suggestions (not a fixed list) so
	// typing a new one here and saving makes it selectable the next time this form loads,
	// with no separate category table/settings page to manage.
	const categories = [...new Set(items.map((i) => i.category).filter((c): c is string => !!c))].sort();

	return { items, categories };
};

const toCentavos = (php: number) => Math.round(php * 100);

const itemSchema = z.object({
	name: z.string().min(2).max(120),
	category: z.string().max(80).optional(),
	pricePhp: z.coerce.number().min(0),
	taxable: z.coerce.boolean(),
	isActive: z.coerce.boolean(),
	sortOrder: z.coerce.number().int().min(0).max(100000)
});

export const actions: Actions = {
	create: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = itemSchema.safeParse({
			...raw,
			taxable: raw.taxable === 'on',
			isActive: raw.isActive === 'on' || raw.isActive === undefined,
			sortOrder: raw.sortOrder || '0'
		});
		if (!parsed.success) return fail(400, { error: 'Check the item details and try again.' });
		const d = parsed.data;

		const [row] = await db
			.insert(amenityItems)
			.values({
				hotelId,
				name: d.name.trim(),
				category: d.category?.trim() || null,
				priceCentavos: toCentavos(d.pricePhp),
				taxable: d.taxable,
				isActive: d.isActive,
				sortOrder: d.sortOrder
			})
			.returning({ id: amenityItems.id });

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'amenity_item.create',
			entityType: 'amenity_item',
			entityId: row!.id,
			after: d
		});

		return { ok: `Added "${d.name}".` };
	},

	update: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const raw = Object.fromEntries(await event.request.formData());
		const itemId = String(raw.itemId ?? '');
		if (!itemId) return fail(400, { error: 'Missing item.' });

		const parsed = itemSchema.safeParse({
			...raw,
			taxable: raw.taxable === 'on',
			isActive: raw.isActive === 'on',
			sortOrder: raw.sortOrder || '0'
		});
		if (!parsed.success) return fail(400, { error: 'Check the item details and try again.' });
		const d = parsed.data;

		await db
			.update(amenityItems)
			.set({
				name: d.name.trim(),
				category: d.category?.trim() || null,
				priceCentavos: toCentavos(d.pricePhp),
				taxable: d.taxable,
				isActive: d.isActive,
				sortOrder: d.sortOrder,
				updatedAt: new Date()
			})
			.where(and(eq(amenityItems.id, itemId), eq(amenityItems.hotelId, hotelId)));

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'amenity_item.update',
			entityType: 'amenity_item',
			entityId: itemId,
			after: d
		});

		return { ok: `Updated "${d.name}".` };
	},

	delete: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const raw = await event.request.formData();
		const itemId = raw.get('itemId');
		if (typeof itemId !== 'string') return fail(400, { error: 'Missing item.' });

		const [used] = await db
			.select({ id: folioCharges.id })
			.from(folioCharges)
			.where(eq(folioCharges.amenityItemId, itemId))
			.limit(1);
		if (used) {
			return fail(400, {
				error: 'This item has already been charged to a guest — deactivate it instead of deleting.'
			});
		}

		await db.delete(amenityItems).where(and(eq(amenityItems.id, itemId), eq(amenityItems.hotelId, hotelId)));

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'amenity_item.delete',
			entityType: 'amenity_item',
			entityId: itemId
		});

		return { ok: 'Item deleted.' };
	}
};
