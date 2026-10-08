import { fail } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { diningItems, diningStations, hotels } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { deleteUploadIfOwned, saveUpload, UploadValidationError } from '$lib/server/uploads';
import { MAX_GALLERY_IMAGES } from '$lib/branding';
import { listStations } from '$lib/server/dining-menu';
import { recordId } from '$lib/rate-validation';
import { diningConfigSchema, parseDiningConfig, mergeDiningConfigIntoConfig } from '$lib/server/dining';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;

	const items = await db
		.select()
		.from(diningItems)
		.where(eq(diningItems.hotelId, hotelId))
		.orderBy(asc(diningItems.sortOrder), asc(diningItems.title));

	return { items, dining: parseDiningConfig(locals.hotel!.config), stations: await listStations(hotelId) };
};

const createSchema = z.object({
	title: z.string().min(2).max(120),
	description: z.string().max(2000).optional(),
	operatingHours: z.string().max(200).optional()
});

// Picked from `diningConfigSchema` rather than redeclared — this action's caps
// must never drift from the read-side schema `parseDiningConfig` validates
// against, or a future edit that passes here but fails there would silently
// drop the *entire* dining config (menu images included) on next read.
const introSchema = diningConfigSchema.pick({
	introEyebrow: true,
	introHeading: true,
	introBody: true
});

const stationName = z.string().trim().min(1, 'Give the station a name.').max(40);

/** Postgres unique-violation, whether drizzle surfaces it directly or on `cause`. */
const isDuplicate = (e: unknown) =>
	(e as { code?: string })?.code === '23505' || (e as { cause?: { code?: string } })?.cause?.code === '23505';

export const actions: Actions = {
	createStation: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ name: stationName })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Give the station a name.' });
		try {
			const [row] = await db
				.insert(diningStations)
				.values({ hotelId, name: parsed.data.name })
				.returning({ id: diningStations.id });
			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'dining_station.create',
				entityType: 'dining_station',
				entityId: row!.id,
				after: parsed.data
			});
		} catch (e) {
			if (isDuplicate(e)) return fail(400, { error: `You already have a station called "${parsed.data.name}".` });
			throw e;
		}
		return { ok: `Added station "${parsed.data.name}".` };
	},

	renameStation: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ stationId: recordId(), name: stationName })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the station name.' });
		try {
			const updated = await db
				.update(diningStations)
				.set({ name: parsed.data.name, updatedAt: new Date() })
				.where(and(eq(diningStations.id, parsed.data.stationId), eq(diningStations.hotelId, hotelId)))
				.returning({ id: diningStations.id });
			if (updated.length === 0) return fail(404, { error: 'Station not found.' });
		} catch (e) {
			if (isDuplicate(e)) return fail(400, { error: `You already have a station called "${parsed.data.name}".` });
			throw e;
		}
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_station.update',
			entityType: 'dining_station',
			entityId: parsed.data.stationId,
			after: { name: parsed.data.name }
		});
		return { ok: 'Station renamed.' };
	},

	deleteStation: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ stationId: recordId() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Station not found.' });
		// Dishes on this station become unassigned (FK is ON DELETE SET NULL).
		const deleted = await db
			.delete(diningStations)
			.where(and(eq(diningStations.id, parsed.data.stationId), eq(diningStations.hotelId, hotelId)))
			.returning({ id: diningStations.id });
		if (deleted.length === 0) return fail(404, { error: 'Station not found.' });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_station.delete',
			entityType: 'dining_station',
			entityId: parsed.data.stationId
		});
		return { ok: 'Station deleted. Its dishes are now unassigned.' };
	},

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

	updateIntro: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotel = event.locals.hotel!;

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = introSchema.safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Check the intro block fields and try again.' });

		const current = parseDiningConfig(hotel.config);
		const nextConfig = mergeDiningConfigIntoConfig(hotel.config, {
			...current,
			introEyebrow: parsed.data.introEyebrow?.trim() || undefined,
			introHeading: parsed.data.introHeading?.trim() || undefined,
			introBody: parsed.data.introBody?.trim() || undefined
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

		return { ok: 'Intro block updated.' };
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
