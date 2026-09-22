import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { saveUpload } from '$lib/server/uploads';
import {
	HousekeepingError,
	getHousekeepingHallBoard,
	getHousekeepingHallDetail,
	getHousekeepingRoomBoard,
	getHousekeepingRoomDetail,
	markHallClean,
	markRoomClean,
	reportHallDamage,
	reportRoomDamage,
	startCleaningHall,
	startCleaningRoom
} from '$lib/server/housekeeping';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'housekeeping:read');
	const hotel = locals.hotel!;
	const [rooms, halls] = await Promise.all([
		getHousekeepingRoomBoard(hotel.id),
		getHousekeepingHallBoard(hotel.id)
	]);
	return { rooms, halls, role: locals.role };
};

export const actions: Actions = {
	roomDetail: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'housekeeping:read');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z.object({ roomId: z.string().uuid() }).safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Missing room.' });
		return { roomDetail: await getHousekeepingRoomDetail(hotelId, parsed.data.roomId) };
	},

	hallDetail: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'housekeeping:read');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z.object({ functionHallId: z.string().uuid() }).safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Missing hall.' });
		return { hallDetail: await getHousekeepingHallDetail(hotelId, parsed.data.functionHallId) };
	},

	startCleaning: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'housekeeping:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z.object({ roomId: z.string().uuid() }).safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Missing room.' });
		try {
			await startCleaningRoom(hotelId, parsed.data.roomId, event.locals.user);
		} catch (e) {
			if (e instanceof HousekeepingError) return fail(400, { error: e.message });
			throw e;
		}
		return { roomDetail: await getHousekeepingRoomDetail(hotelId, parsed.data.roomId) };
	},

	startCleaningHall: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'housekeeping:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z.object({ functionHallId: z.string().uuid() }).safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Missing hall.' });
		try {
			await startCleaningHall(hotelId, parsed.data.functionHallId, event.locals.user);
		} catch (e) {
			if (e instanceof HousekeepingError) return fail(400, { error: e.message });
			throw e;
		}
		return { hallDetail: await getHousekeepingHallDetail(hotelId, parsed.data.functionHallId) };
	},

	markClean: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'housekeeping:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z.object({ roomId: z.string().uuid() }).safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Missing room.' });
		await markRoomClean(hotelId, parsed.data.roomId, event.locals.user);
		return { roomDetail: await getHousekeepingRoomDetail(hotelId, parsed.data.roomId) };
	},

	markCleanHall: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'housekeeping:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z.object({ functionHallId: z.string().uuid() }).safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Missing hall.' });
		await markHallClean(hotelId, parsed.data.functionHallId, event.locals.user);
		return { hallDetail: await getHousekeepingHallDetail(hotelId, parsed.data.functionHallId) };
	},

	reportDamage: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'housekeeping:write');
		const hotelId = event.locals.hotel!.id;
		const raw = await event.request.formData();
		const roomId = raw.get('roomId');
		const description = raw.get('description');
		if (typeof roomId !== 'string' || typeof description !== 'string' || !description.trim()) {
			return fail(400, { damageError: 'Describe the damage first.' });
		}
		const photo = raw.get('photo');
		if (!(photo instanceof File) || photo.size === 0) {
			return fail(400, { damageError: 'Attach a photo first.' });
		}
		try {
			const photoUrl = await saveUpload(hotelId, photo);
			await reportRoomDamage(hotelId, roomId, { description, photoUrl }, event.locals.user);
		} catch (e) {
			console.error('reportDamage: could not save damage report', roomId, e);
			return fail(400, {
				roomDetail: await getHousekeepingRoomDetail(hotelId, roomId),
				damageError: 'Could not save the report — try again.'
			});
		}
		return {
			roomDetail: await getHousekeepingRoomDetail(hotelId, roomId),
			damageOk: true
		};
	},

	reportHallDamage: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'housekeeping:write');
		const hotelId = event.locals.hotel!.id;
		const raw = await event.request.formData();
		const functionHallId = raw.get('functionHallId');
		const description = raw.get('description');
		if (
			typeof functionHallId !== 'string' ||
			typeof description !== 'string' ||
			!description.trim()
		) {
			return fail(400, { damageError: 'Describe the damage first.' });
		}
		const photo = raw.get('photo');
		if (!(photo instanceof File) || photo.size === 0) {
			return fail(400, { damageError: 'Attach a photo first.' });
		}
		try {
			const photoUrl = await saveUpload(hotelId, photo);
			await reportHallDamage(hotelId, functionHallId, { description, photoUrl }, event.locals.user);
		} catch (e) {
			console.error('reportHallDamage: could not save damage report', functionHallId, e);
			return fail(400, {
				hallDetail: await getHousekeepingHallDetail(hotelId, functionHallId),
				damageError: 'Could not save the report — try again.'
			});
		}
		return {
			hallDetail: await getHousekeepingHallDetail(hotelId, functionHallId),
			damageOk: true
		};
	}
};
