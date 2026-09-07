import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { diningItems } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { deleteUploadIfOwned, saveUpload, UploadValidationError } from '$lib/server/uploads';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;

	const [item] = await db
		.select()
		.from(diningItems)
		.where(and(eq(diningItems.id, params.diningItemId), eq(diningItems.hotelId, hotelId)))
		.limit(1);
	if (!item) error(404, 'Dining item not found');

	return { item };
};

const updateSchema = z.object({
	title: z.string().min(2).max(120),
	description: z.string().max(2000).optional(),
	operatingHours: z.string().max(200).optional(),
	isActive: z.coerce.boolean(),
	sortOrder: z.coerce.number().int().min(0).max(999)
});

export const actions: Actions = {
	update: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const diningItemId = event.params.diningItemId;

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = updateSchema.safeParse({ ...raw, isActive: raw.isActive === 'on' });
		if (!parsed.success) return fail(400, { error: 'Check the dining item details and try again.' });

		await db
			.update(diningItems)
			.set({
				title: parsed.data.title.trim(),
				description: parsed.data.description?.trim() || null,
				operatingHours: parsed.data.operatingHours?.trim() || null,
				isActive: parsed.data.isActive,
				sortOrder: parsed.data.sortOrder,
				updatedAt: new Date()
			})
			.where(and(eq(diningItems.id, diningItemId), eq(diningItems.hotelId, hotelId)));

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_item.update',
			entityType: 'dining_item',
			entityId: diningItemId
		});

		return { ok: 'Dining item updated.' };
	},

	uploadPhoto: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const diningItemId = event.params.diningItemId;

		const [item] = await db
			.select({ photoUrl: diningItems.photoUrl })
			.from(diningItems)
			.where(and(eq(diningItems.id, diningItemId), eq(diningItems.hotelId, hotelId)))
			.limit(1);
		if (!item) return fail(404, { error: 'Dining item not found.' });

		const raw = await event.request.formData();
		const file = raw.get('photo');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Choose a photo.' });
		}

		try {
			const uploaded = await saveUpload(hotelId, file);
			await deleteUploadIfOwned(item.photoUrl);
			await db
				.update(diningItems)
				.set({ photoUrl: uploaded, updatedAt: new Date() })
				.where(and(eq(diningItems.id, diningItemId), eq(diningItems.hotelId, hotelId)));

			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'dining_item.update',
				entityType: 'dining_item',
				entityId: diningItemId
			});

			return { ok: 'Photo updated.' };
		} catch (e) {
			if (e instanceof UploadValidationError) return fail(400, { error: e.message });
			throw e;
		}
	},

	removePhoto: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const diningItemId = event.params.diningItemId;

		const [item] = await db
			.select({ photoUrl: diningItems.photoUrl })
			.from(diningItems)
			.where(and(eq(diningItems.id, diningItemId), eq(diningItems.hotelId, hotelId)))
			.limit(1);
		if (!item) return fail(404, { error: 'Dining item not found.' });

		await deleteUploadIfOwned(item.photoUrl);
		await db
			.update(diningItems)
			.set({ photoUrl: null, updatedAt: new Date() })
			.where(and(eq(diningItems.id, diningItemId), eq(diningItems.hotelId, hotelId)));

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_item.update',
			entityType: 'dining_item',
			entityId: diningItemId
		});

		return { ok: 'Photo removed.' };
	},

	delete: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const diningItemId = event.params.diningItemId;

		const [item] = await db
			.select({ photoUrl: diningItems.photoUrl })
			.from(diningItems)
			.where(and(eq(diningItems.id, diningItemId), eq(diningItems.hotelId, hotelId)))
			.limit(1);
		if (!item) error(404, 'Dining item not found');

		await deleteUploadIfOwned(item.photoUrl);
		await db
			.delete(diningItems)
			.where(and(eq(diningItems.id, diningItemId), eq(diningItems.hotelId, hotelId)));

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_item.delete',
			entityType: 'dining_item',
			entityId: diningItemId
		});

		redirect(303, `/${event.params.hotel}/settings/dining`);
	}
};
