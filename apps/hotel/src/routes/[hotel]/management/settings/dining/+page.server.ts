import { fail } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { diningItems, hotels } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { deleteUploadIfOwned, saveUpload, UploadValidationError } from '$lib/server/uploads';
import { MAX_GALLERY_IMAGES } from '$lib/branding';
import { parseDiningConfig, mergeDiningConfigIntoConfig } from '$lib/server/dining';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;

	const items = await db
		.select()
		.from(diningItems)
		.where(eq(diningItems.hotelId, hotelId))
		.orderBy(asc(diningItems.sortOrder), asc(diningItems.title));

	return { items, dining: parseDiningConfig(locals.hotel!.config) };
};

const createSchema = z.object({
	title: z.string().min(2).max(120),
	description: z.string().max(2000).optional(),
	operatingHours: z.string().max(200).optional()
});

export const actions: Actions = {
	create: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = createSchema.safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Check the dining item details and try again.' });

		const [row] = await db
			.insert(diningItems)
			.values({
				hotelId,
				title: parsed.data.title.trim(),
				description: parsed.data.description?.trim() || null,
				operatingHours: parsed.data.operatingHours?.trim() || null
			})
			.returning({ id: diningItems.id });

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_item.create',
			entityType: 'dining_item',
			entityId: row!.id,
			after: parsed.data
		});

		return { ok: `Created "${parsed.data.title}".`, createdItemId: row!.id };
	},

	uploadMenuImages: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotel = event.locals.hotel!;
		const current = parseDiningConfig(hotel.config);
		const existing = current.menuImages ?? [];

		const raw = await event.request.formData();
		const files = raw.getAll('images').filter((f): f is File => f instanceof File && f.size > 0);
		if (files.length === 0) return fail(400, { error: 'Choose at least one photo.' });

		const room = MAX_GALLERY_IMAGES - existing.length;
		if (room <= 0) {
			return fail(400, {
				error: `You already have ${MAX_GALLERY_IMAGES} menu photos — remove one first.`
			});
		}

		try {
			const uploaded = await Promise.all(files.slice(0, room).map((f) => saveUpload(hotel.id, f)));
			const nextConfig = mergeDiningConfigIntoConfig(hotel.config, {
				...current,
				menuImages: [...existing, ...uploaded]
			});
			await db
				.update(hotels)
				.set({ config: nextConfig, updatedAt: new Date() })
				.where(eq(hotels.id, hotel.id));
			await writeAudit({
				hotelId: hotel.id,
				actor: event.locals.user,
				action: 'hotel.update_dining_config',
				entityType: 'hotel',
				entityId: hotel.id
			});

			const skipped = files.length - uploaded.length;
			return {
				ok:
					`Added ${uploaded.length} photo${uploaded.length === 1 ? '' : 's'}.` +
					(skipped > 0 ? ` ${skipped} skipped — menu photo limit reached.` : '')
			};
		} catch (e) {
			if (e instanceof UploadValidationError) return fail(400, { error: e.message });
			throw e;
		}
	},

	removeMenuImage: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotel = event.locals.hotel!;
		const current = parseDiningConfig(hotel.config);

		const raw = await event.request.formData();
		const url = String(raw.get('url') ?? '');
		const next = (current.menuImages ?? []).filter((u) => u !== url);

		await deleteUploadIfOwned(url);
		const nextConfig = mergeDiningConfigIntoConfig(hotel.config, {
			...current,
			menuImages: next.length > 0 ? next : undefined
		});
		await db
			.update(hotels)
			.set({ config: nextConfig, updatedAt: new Date() })
			.where(eq(hotels.id, hotel.id));
		await writeAudit({
			hotelId: hotel.id,
			actor: event.locals.user,
			action: 'hotel.update_dining_config',
			entityType: 'hotel',
			entityId: hotel.id
		});

		return { ok: 'Photo removed.' };
	}
};
