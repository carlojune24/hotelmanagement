import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { functionHalls, hallBookings } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { deleteUploadIfOwned, saveUpload, UploadValidationError } from '$lib/server/uploads';
import type { RoomPhoto } from '$lib/server/db/schema/inventory';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;

	const [hall] = await db
		.select()
		.from(functionHalls)
		.where(and(eq(functionHalls.id, params.functionHallId), eq(functionHalls.hotelId, hotelId)))
		.limit(1);
	if (!hall) error(404, 'Function hall not found');

	const [existingBooking] = await db
		.select({ id: hallBookings.id })
		.from(hallBookings)
		.where(eq(hallBookings.functionHallId, params.functionHallId))
		.limit(1);

	return { hall, hasBookings: Boolean(existingBooking) };
};

const toCentavos = (php: number) => Math.round(php * 100);
const csvToArray = (csv: string | undefined) =>
	(csv ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

const updateSchema = z.object({
	name: z.string().min(2).max(120),
	description: z.string().max(4000).optional(),
	capacity: z.coerce.number().int().min(1).max(2000),
	baseHours: z.coerce.number().int().min(1).max(24),
	basePricePhp: z.coerce.number().min(0),
	extraHourFeePhp: z.coerce.number().min(0),
	includedServicesCsv: z.string().optional(),
	supportedEventTypesCsv: z.string().optional(),
	isActive: z.coerce.boolean(),
	sortOrder: z.coerce.number().int().min(0).max(999)
});

export const actions: Actions = {
	update: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const functionHallId = event.params.functionHallId;

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = updateSchema.safeParse({ ...raw, isActive: raw.isActive === 'on' });
		if (!parsed.success) return fail(400, { error: 'Check the function hall details and try again.' });

		await db
			.update(functionHalls)
			.set({
				name: parsed.data.name.trim(),
				description: parsed.data.description?.trim() || null,
				capacity: parsed.data.capacity,
				baseHours: parsed.data.baseHours,
				basePriceCentavos: toCentavos(parsed.data.basePricePhp),
				extraHourFeeCentavos: toCentavos(parsed.data.extraHourFeePhp),
				includedServices: csvToArray(parsed.data.includedServicesCsv),
				supportedEventTypes: csvToArray(parsed.data.supportedEventTypesCsv),
				isActive: parsed.data.isActive,
				sortOrder: parsed.data.sortOrder,
				updatedAt: new Date()
			})
			.where(and(eq(functionHalls.id, functionHallId), eq(functionHalls.hotelId, hotelId)));

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'function_hall.update',
			entityType: 'function_hall',
			entityId: functionHallId
		});

		return { ok: 'Function hall updated.' };
	},

	uploadPhotos: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const functionHallId = event.params.functionHallId;

		const [hall] = await db
			.select({ photos: functionHalls.photos })
			.from(functionHalls)
			.where(and(eq(functionHalls.id, functionHallId), eq(functionHalls.hotelId, hotelId)))
			.limit(1);
		if (!hall) return fail(404, { error: 'Function hall not found.' });
		const existing = (hall.photos as RoomPhoto[]) ?? [];

		const raw = await event.request.formData();
		const files = raw.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
		if (files.length === 0) return fail(400, { error: 'Choose at least one photo.' });

		const MAX_HALL_PHOTOS = 16;
		const room = MAX_HALL_PHOTOS - existing.length;
		if (room <= 0) {
			return fail(400, { error: `You already have ${MAX_HALL_PHOTOS} photos — remove one first.` });
		}

		try {
			const uploaded = await Promise.all(
				files.slice(0, room).map(async (f) => ({
					url: await saveUpload(hotelId, f),
					tag: existing.length === 0 ? 'cover' : 'gallery'
				}))
			);
			await db
				.update(functionHalls)
				.set({ photos: [...existing, ...uploaded], updatedAt: new Date() })
				.where(and(eq(functionHalls.id, functionHallId), eq(functionHalls.hotelId, hotelId)));

			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'function_hall.update',
				entityType: 'function_hall',
				entityId: functionHallId
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
		const functionHallId = event.params.functionHallId;

		const [hall] = await db
			.select({ photos: functionHalls.photos })
			.from(functionHalls)
			.where(and(eq(functionHalls.id, functionHallId), eq(functionHalls.hotelId, hotelId)))
			.limit(1);
		if (!hall) return fail(404, { error: 'Function hall not found.' });

		const raw = await event.request.formData();
		const url = String(raw.get('url') ?? '');
		const existing = (hall.photos as RoomPhoto[]) ?? [];
		const next = existing.filter((p) => p.url !== url);

		await deleteUploadIfOwned(url);
		await db
			.update(functionHalls)
			.set({ photos: next, updatedAt: new Date() })
			.where(and(eq(functionHalls.id, functionHallId), eq(functionHalls.hotelId, hotelId)));

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'function_hall.update',
			entityType: 'function_hall',
			entityId: functionHallId
		});

		return { ok: 'Photo removed.' };
	},

	delete: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const functionHallId = event.params.functionHallId;

		const [existing] = await db
			.select({ id: hallBookings.id })
			.from(hallBookings)
			.where(eq(hallBookings.functionHallId, functionHallId))
			.limit(1);
		if (existing) {
			return fail(400, { error: 'This hall has bookings on record and can’t be deleted.' });
		}

		await db
			.delete(functionHalls)
			.where(and(eq(functionHalls.id, functionHallId), eq(functionHalls.hotelId, hotelId)));

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'function_hall.delete',
			entityType: 'function_hall',
			entityId: functionHallId
		});

		redirect(303, `/${event.params.hotel}/settings/function-halls`);
	}
};
