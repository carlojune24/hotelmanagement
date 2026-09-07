import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	amenities,
	ratePlans,
	roomOperationalStatus,
	roomTypeAmenities,
	rooms,
	roomTypes
} from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import type { RoomPhoto } from '$lib/server/db/schema/inventory';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	const hotelId = locals.hotel!.id;

	const [room] = await db
		.select()
		.from(rooms)
		.where(and(eq(rooms.id, params.roomId), eq(rooms.hotelId, hotelId)))
		.limit(1);
	if (!room) error(404, 'Room not found');

	const [roomType] = await db
		.select()
		.from(roomTypes)
		.where(eq(roomTypes.id, room.roomTypeId))
		.limit(1);

	const plans = roomType
		? await db
				.select()
				.from(ratePlans)
				.where(and(eq(ratePlans.hotelId, hotelId), eq(ratePlans.roomTypeId, roomType.id)))
				.orderBy(asc(ratePlans.name))
		: [];

	// Amenities inherited from the room type — read-only on the physical room page.
	const typeAmenities = roomType
		? await db
				.select({ name: amenities.name, isHighlighted: roomTypeAmenities.isHighlighted })
				.from(roomTypeAmenities)
				.innerJoin(amenities, eq(amenities.id, roomTypeAmenities.amenityId))
				.where(eq(roomTypeAmenities.roomTypeId, roomType.id))
				.orderBy(asc(roomTypeAmenities.sortOrder), asc(amenities.name))
		: [];

	return {
		room,
		roomType,
		roomTypeAmenities: typeAmenities,
		ratePlans: plans,
		currency: locals.hotel!.currency,
		vatRateBps: locals.hotel!.vatRateBps
	};
};

const updateSchema = z.object({
	roomNumber: z.string().min(1).max(20),
	floor: z.string().max(20).optional(),
	buildingBlock: z.string().max(20).optional(),
	notes: z.string().max(500).optional(),
	operationalStatus: z.enum(roomOperationalStatus.enumValues),
	isConnecting: z.coerce.boolean(),
	isActive: z.coerce.boolean(),
	sortOrder: z.coerce.number().int().min(0).max(100000),
	displayTitle: z.string().max(200).optional(),
	tagline: z.string().max(300).optional(),
	shortDescription: z.string().max(500).optional(),
	photosJson: z.string()
});

function parsePhotos(raw: string): RoomPhoto[] {
	try {
		const value = JSON.parse(raw);
		return Array.isArray(value) ? value : [];
	} catch {
		return [];
	}
}

export const actions: Actions = {
	update: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const roomId = event.params.roomId;

		const raw = Object.fromEntries(await event.request.formData());
		const parsed = updateSchema.safeParse({
			...raw,
			isConnecting: raw.isConnecting === 'on',
			isActive: raw.isActive === 'on'
		});
		if (!parsed.success) return fail(400, { error: 'Check the room details and try again.' });

		try {
			await db
				.update(rooms)
				.set({
					roomNumber: parsed.data.roomNumber.trim(),
					floor: parsed.data.floor?.trim() || null,
					buildingBlock: parsed.data.buildingBlock?.trim() || null,
					notes: parsed.data.notes?.trim() || null,
					operationalStatus: parsed.data.operationalStatus,
					isConnecting: parsed.data.isConnecting,
					isActive: parsed.data.isActive,
					sortOrder: parsed.data.sortOrder,
					displayTitle: parsed.data.displayTitle?.trim() || null,
					tagline: parsed.data.tagline?.trim() || null,
					shortDescription: parsed.data.shortDescription?.trim() || null,
					photos: parsePhotos(parsed.data.photosJson),
					updatedAt: new Date()
				})
				.where(and(eq(rooms.id, roomId), eq(rooms.hotelId, hotelId)));
		} catch (e) {
			if (e instanceof Error && 'code' in e && (e as { code: string }).code === '23505') {
				return fail(400, { error: `Room "${parsed.data.roomNumber}" already exists.` });
			}
			throw e;
		}

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'room.update',
			entityType: 'room',
			entityId: roomId,
			after: parsed.data
		});

		return { ok: 'Room updated.' };
	},

	delete: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const roomId = event.params.roomId;

		await db.delete(rooms).where(and(eq(rooms.id, roomId), eq(rooms.hotelId, hotelId)));

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'room.delete',
			entityType: 'room',
			entityId: roomId
		});

		redirect(303, `/${event.params.hotel}/settings/rooms`);
	}
};
