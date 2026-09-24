import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { diningItems } from '$lib/server/db/schema/index';
import type { DiningPhoto } from '$lib/server/db/schema/dining';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { deleteUploadIfOwned, saveUpload, UploadValidationError } from '$lib/server/uploads';
import type { Actions, PageServerLoad } from './$types';

const MAX_DINING_ITEM_PHOTOS = 12;

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
	category: z.string().max(60).optional(),
	tagline: z.string().max(160).optional(),
	description: z.string().max(2000).optional(),
	/** One highlight per line from a textarea — filtered/trimmed below, not by zod. */
	highlights: z.string().max(2000).optional(),
	operatingHours: z.string().max(200).optional(),
	isActive: z.coerce.boolean(),
	sortOrder: z.coerce.number().int().min(0).max(999)
});

/** Textarea → `string[]`: one highlight per non-blank line, capped at 6 — a venue
 *  card has room for a short list, not a second description. */
function parseHighlights(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
		.slice(0, 6);
}

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
				category: parsed.data.category?.trim() || null,
				tagline: parsed.data.tagline?.trim() || null,
				description: parsed.data.description?.trim() || null,
				highlights: parseHighlights(parsed.data.highlights),
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

	uploadPhotos: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const diningItemId = event.params.diningItemId;

		const [item] = await db
			.select({ photos: diningItems.photos })
			.from(diningItems)
			.where(and(eq(diningItems.id, diningItemId), eq(diningItems.hotelId, hotelId)))
			.limit(1);
		if (!item) return fail(404, { error: 'Dining item not found.' });
		let existing = (item.photos as DiningPhoto[]) ?? [];

		const raw = await event.request.formData();
		const files = raw.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
		if (files.length === 0) return fail(400, { error: 'Choose at least one photo.' });

		const tag = raw.get('tag') === 'cover' ? 'cover' : 'gallery';
		// A venue has one cover shot — uploading a new one demotes whichever photo
		// (if any) currently holds that tag, rather than leaving two.
		if (tag === 'cover') {
			existing = existing.map((p) => (p.tag === 'cover' ? { ...p, tag: 'gallery' } : p));
		}

		const room = MAX_DINING_ITEM_PHOTOS - existing.length;
		if (room <= 0) {
			return fail(400, {
				error: `You already have ${MAX_DINING_ITEM_PHOTOS} photos — remove one first.`
			});
		}

		try {
			const uploaded = await Promise.all(
				files.slice(0, room).map(async (f) => ({ url: await saveUpload(hotelId, f), tag }))
			);
			// Only the first upload in this batch keeps the "cover" tag if more than one
			// file was chosen at once — a venue still has exactly one cover shot.
			if (tag === 'cover' && uploaded.length > 1) {
				for (let i = 1; i < uploaded.length; i++) uploaded[i]!.tag = 'gallery';
			}

			await db
				.update(diningItems)
				.set({ photos: [...existing, ...uploaded], updatedAt: new Date() })
				.where(and(eq(diningItems.id, diningItemId), eq(diningItems.hotelId, hotelId)));

			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'dining_item.update',
				entityType: 'dining_item',
				entityId: diningItemId
			});

			const skipped = files.length - uploaded.length;
			return {
				ok:
					`Added ${uploaded.length} photo${uploaded.length === 1 ? '' : 's'}.` +
					(skipped > 0 ? ` ${skipped} skipped — photo limit reached.` : '')
			};
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
			.select({ photos: diningItems.photos })
			.from(diningItems)
			.where(and(eq(diningItems.id, diningItemId), eq(diningItems.hotelId, hotelId)))
			.limit(1);
		if (!item) return fail(404, { error: 'Dining item not found.' });

		const raw = await event.request.formData();
		const url = String(raw.get('url') ?? '');
		const existing = (item.photos as DiningPhoto[]) ?? [];
		const next = existing.filter((p) => p.url !== url);

		await deleteUploadIfOwned(url);
		await db
			.update(diningItems)
			.set({ photos: next, updatedAt: new Date() })
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
			.select({ photos: diningItems.photos })
			.from(diningItems)
			.where(and(eq(diningItems.id, diningItemId), eq(diningItems.hotelId, hotelId)))
			.limit(1);
		if (!item) error(404, 'Dining item not found');

		await Promise.all(
			((item.photos as DiningPhoto[]) ?? []).map((p) => deleteUploadIfOwned(p.url))
		);
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

		redirect(303, `/${event.params.hotel}/management/settings/dining`);
	}
};
