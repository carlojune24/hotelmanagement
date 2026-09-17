import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { rooms, roomTypes } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'hotel:admin');
	return {};
};

const createTypeSchema = z.object({
	name: z.string().min(2).max(120),
	baseOccupancy: z.coerce.number().int().min(1).max(20),
	maxOccupancy: z.coerce.number().int().min(1).max(20)
});

const createRoomSchema = z.object({
	roomTypeId: z.string().uuid(),
	roomNumber: z.string().min(1).max(20),
	floor: z.string().max(20).optional(),
	buildingBlock: z.string().max(20).optional()
});

export const actions: Actions = {
	createType: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const parsed = createTypeSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the room type details and try again.' });
		if (parsed.data.maxOccupancy < parsed.data.baseOccupancy) {
			return fail(400, { error: 'Max occupancy must be at least base occupancy.' });
		}

		const [row] = await db
			.insert(roomTypes)
			.values({
				hotelId,
				name: parsed.data.name.trim(),
				baseOccupancy: parsed.data.baseOccupancy,
				maxOccupancy: parsed.data.maxOccupancy
			})
			.returning({ id: roomTypes.id });

		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'room_type.create',
			entityType: 'room_type',
			entityId: row!.id,
			after: parsed.data
		});

		return { ok: `Created room type "${parsed.data.name}".`, createdTypeId: row!.id };
	},

	createRoom: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;

		const parsed = createRoomSchema.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Enter a room number and type.' });

		try {
			const [row] = await db
				.insert(rooms)
				.values({
					hotelId,
					roomTypeId: parsed.data.roomTypeId,
					roomNumber: parsed.data.roomNumber.trim(),
					floor: parsed.data.floor?.trim() || null,
					buildingBlock: parsed.data.buildingBlock?.trim() || null
				})
				.returning({ id: rooms.id });

			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'room.create',
				entityType: 'room',
				entityId: row!.id,
				after: parsed.data
			});

			return { ok: `Added room ${parsed.data.roomNumber}.`, createdRoomId: row!.id };
		} catch (e) {
			if (e instanceof Error && 'code' in e && (e as { code: string }).code === '23505') {
				return fail(400, { error: `Room "${parsed.data.roomNumber}" already exists.` });
			}
			throw e;
		}
	}
};
