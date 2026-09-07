import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { amenityItems } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { getHallBookingDetail, getRoomBookingDetail } from '$lib/server/reservations';
import { searchAvailability } from '$lib/server/availability';
import {
	FolioError,
	addAmenityItemCharge,
	addExtensionFeeCharge,
	getFolioDetail,
	settleFolioBalance,
	voidFolioCharge,
	type ExtensionFeeKind
} from '$lib/server/folio';
import {
	CheckOutError,
	HallCompleteError,
	HallWalkInError,
	WalkInError,
	checkOutBooking,
	completeHallBooking,
	createWalkInBooking,
	createWalkInHallBooking,
	getHallStatusBoard,
	getRoomStatusGrid,
	todayInTimezone
} from '$lib/server/front-desk';
import { MAX_ROOMS_PER_LINE } from '$lib/pricing-utils';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const hotel = locals.hotel!;
	const businessDate = todayInTimezone(hotel.timezone);
	const [grid, hallGrid, amenityItemOptions] = await Promise.all([
		getRoomStatusGrid(hotel.id, businessDate),
		getHallStatusBoard(hotel.id, businessDate),
		db
			.select({
				id: amenityItems.id,
				name: amenityItems.name,
				priceCentavos: amenityItems.priceCentavos,
				taxable: amenityItems.taxable
			})
			.from(amenityItems)
			.where(and(eq(amenityItems.hotelId, hotel.id), eq(amenityItems.isActive, true)))
			.orderBy(asc(amenityItems.sortOrder), asc(amenityItems.name))
	]);
	return {
		businessDate,
		checkInTime: hotel.checkInTime,
		checkOutTime: hotel.checkOutTime,
		lateCheckoutFeePerHourCentavos: hotel.lateCheckoutFeePerHourCentavos,
		earlyCheckInFeePerHourCentavos: hotel.earlyCheckInFeePerHourCentavos,
		amenityItemOptions,
		hallGrid,
		...grid
	};
};

/** Shared by `roomDetail` and every room-folio-mutating action, so the dialog always re-renders
 *  from the same `{roomDetail, folio}` shape regardless of which action produced it. */
async function loadRoomDetailPayload(hotelId: string, bookingId: string) {
	const detail = await getRoomBookingDetail(hotelId, bookingId);
	if (!detail) error(404, 'Booking not found');
	const folio = await getFolioDetail(hotelId, { kind: 'room', bookingId });
	return { roomDetail: detail, folio };
}

/** Same idea as `loadRoomDetailPayload`, for a function hall booking's dialog. */
async function loadHallDetailPayload(hotelId: string, hallBookingId: string) {
	const detail = await getHallBookingDetail(hotelId, hallBookingId);
	if (!detail) error(404, 'Hall booking not found');
	const folio = await getFolioDetail(hotelId, { kind: 'hall', hallBookingId });
	return { hallBookingDetail: detail, hallFolio: folio };
}

const searchSchema = z.object({
	checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	occupancy: z.coerce.number().int().min(1).max(20),
	roomCount: z.coerce.number().int().min(1).max(MAX_ROOMS_PER_LINE)
});

const createSchema = z.object({
	fullName: z.string().min(2).max(160),
	email: z.string().email(),
	phone: z.string().max(40).optional(),
	specialRequests: z.string().max(1000).optional(),
	roomTypeId: z.string().uuid(),
	ratePlanId: z.string().uuid(),
	checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	occupancy: z.coerce.number().int().min(1).max(20),
	roomCount: z.coerce.number().int().min(1).max(MAX_ROOMS_PER_LINE)
});

const hallCreateSchema = z.object({
	functionHallId: z.string().uuid(),
	eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	startTime: z.string().regex(/^\d{2}:\d{2}$/),
	endTime: z.string().regex(/^\d{2}:\d{2}$/),
	eventType: z.string().min(1).max(80),
	guestCount: z.coerce.number().int().min(1),
	fullName: z.string().min(2).max(160),
	email: z.string().email(),
	phone: z.string().max(40).optional(),
	specialRequests: z.string().max(1000).optional()
});

export const actions: Actions = {
	roomDetail: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:read');
		const hotelId = event.locals.hotel!.id;
		const raw = await event.request.formData();
		const bookingId = raw.get('bookingId');
		if (typeof bookingId !== 'string') return fail(400, { error: 'Missing booking.' });

		return loadRoomDetailPayload(hotelId, bookingId);
	},

	addItemCharge: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z
			.object({
				bookingId: z.string().uuid(),
				amenityItemId: z.string().uuid(),
				quantity: z.coerce.number().int().min(1).max(1000)
			})
			.safeParse(raw);
		if (!parsed.success) return fail(400, { folioError: 'Select an item and quantity.' });

		try {
			await addAmenityItemCharge(
				hotelId,
				{ kind: 'room', bookingId: parsed.data.bookingId },
				parsed.data.amenityItemId,
				parsed.data.quantity,
				event.locals.user
			);
		} catch (e) {
			if (e instanceof FolioError) return fail(400, { folioError: e.message });
			throw e;
		}
		return loadRoomDetailPayload(hotelId, parsed.data.bookingId);
	},

	addExtensionCharge: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z
			.object({
				bookingId: z.string().uuid(),
				kind: z.enum(['late_checkout', 'early_check_in']),
				hours: z.coerce.number().min(0.5).max(48)
			})
			.safeParse(raw);
		if (!parsed.success) return fail(400, { folioError: 'Enter a valid number of hours.' });

		try {
			await addExtensionFeeCharge(
				hotelId,
				parsed.data.bookingId,
				parsed.data.kind as ExtensionFeeKind,
				parsed.data.hours,
				event.locals.user
			);
		} catch (e) {
			if (e instanceof FolioError) return fail(400, { folioError: e.message });
			throw e;
		}
		return loadRoomDetailPayload(hotelId, parsed.data.bookingId);
	},

	settleFolio: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = await event.request.formData();
		const bookingId = raw.get('bookingId');
		if (typeof bookingId !== 'string') return fail(400, { folioError: 'Missing booking.' });

		try {
			await settleFolioBalance(hotelId, { kind: 'room', bookingId }, event.locals.user);
		} catch (e) {
			if (e instanceof FolioError) return fail(400, { folioError: e.message });
			throw e;
		}
		return loadRoomDetailPayload(hotelId, bookingId);
	},

	voidCharge: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z.object({ bookingId: z.string().uuid(), chargeId: z.string().uuid(), reason: z.string().max(300).optional() }).safeParse(raw);
		if (!parsed.success) return fail(400, { folioError: 'Missing charge.' });

		try {
			await voidFolioCharge(
				hotelId,
				{ kind: 'room', bookingId: parsed.data.bookingId },
				parsed.data.chargeId,
				parsed.data.reason ?? null,
				event.locals.user
			);
		} catch (e) {
			if (e instanceof FolioError) return fail(400, { folioError: e.message });
			throw e;
		}
		return loadRoomDetailPayload(hotelId, parsed.data.bookingId);
	},

	checkOut: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotel = event.locals.hotel!;
		const raw = await event.request.formData();
		const bookingId = raw.get('bookingId');
		if (typeof bookingId !== 'string') return fail(400, { error: 'Missing booking.' });

		try {
			await checkOutBooking(hotel.id, bookingId, todayInTimezone(hotel.timezone), event.locals.user);
			return { ok: 'Guest checked out.' };
		} catch (e) {
			if (e instanceof CheckOutError) return fail(400, { error: e.message });
			throw e;
		}
	},

	walkInSearch: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = searchSchema.safeParse(raw);
		if (!parsed.success) return fail(400, { walkInError: 'Check the dates and try again.' });
		const search = parsed.data;

		if (search.checkIn >= search.checkOut) {
			return { walkInSearch: search, availableRoomTypes: [], walkInError: 'Check-out must be after check-in.' };
		}
		const availableRoomTypes = await searchAvailability({ hotelId, ...search });
		return { walkInSearch: search, availableRoomTypes };
	},

	walkInCreate: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = createSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, { walkInError: 'Check the guest details and selection and try again.' });
		}
		const d = parsed.data;

		let bookingId: string;
		try {
			const result = await createWalkInBooking({
				hotelId,
				guest: {
					fullName: d.fullName,
					email: d.email,
					phone: d.phone ?? null,
					specialRequests: d.specialRequests ?? null
				},
				roomTypeId: d.roomTypeId,
				ratePlanId: d.ratePlanId,
				checkIn: d.checkIn,
				checkOut: d.checkOut,
				occupancy: d.occupancy,
				roomCount: d.roomCount,
				actor: event.locals.user
			});
			bookingId = result.bookingId;
		} catch (e) {
			if (e instanceof WalkInError) return fail(400, { walkInError: e.message });
			throw e;
		}

		redirect(303, `/${event.locals.hotel!.slug}/reservations/room/${bookingId}`);
	},

	completeHall: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = await event.request.formData();
		const hallBookingId = raw.get('hallBookingId');
		if (typeof hallBookingId !== 'string') return fail(400, { error: 'Missing hall booking.' });

		try {
			await completeHallBooking(hotelId, hallBookingId, event.locals.user);
			return { ok: 'Event marked completed.' };
		} catch (e) {
			if (e instanceof HallCompleteError) return fail(400, { error: e.message });
			throw e;
		}
	},

	hallDetail: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:read');
		const hotelId = event.locals.hotel!.id;
		const raw = await event.request.formData();
		const hallBookingId = raw.get('hallBookingId');
		if (typeof hallBookingId !== 'string') return fail(400, { error: 'Missing hall booking.' });

		return loadHallDetailPayload(hotelId, hallBookingId);
	},

	addHallItemCharge: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z
			.object({
				hallBookingId: z.string().uuid(),
				amenityItemId: z.string().uuid(),
				quantity: z.coerce.number().int().min(1).max(1000)
			})
			.safeParse(raw);
		if (!parsed.success) return fail(400, { folioError: 'Select an item and quantity.' });

		try {
			await addAmenityItemCharge(
				hotelId,
				{ kind: 'hall', hallBookingId: parsed.data.hallBookingId },
				parsed.data.amenityItemId,
				parsed.data.quantity,
				event.locals.user
			);
		} catch (e) {
			if (e instanceof FolioError) return fail(400, { folioError: e.message });
			throw e;
		}
		return loadHallDetailPayload(hotelId, parsed.data.hallBookingId);
	},

	settleHallFolio: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = await event.request.formData();
		const hallBookingId = raw.get('hallBookingId');
		if (typeof hallBookingId !== 'string') return fail(400, { folioError: 'Missing hall booking.' });

		try {
			await settleFolioBalance(hotelId, { kind: 'hall', hallBookingId }, event.locals.user);
		} catch (e) {
			if (e instanceof FolioError) return fail(400, { folioError: e.message });
			throw e;
		}
		return loadHallDetailPayload(hotelId, hallBookingId);
	},

	voidHallCharge: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z
			.object({ hallBookingId: z.string().uuid(), chargeId: z.string().uuid(), reason: z.string().max(300).optional() })
			.safeParse(raw);
		if (!parsed.success) return fail(400, { folioError: 'Missing charge.' });

		try {
			await voidFolioCharge(
				hotelId,
				{ kind: 'hall', hallBookingId: parsed.data.hallBookingId },
				parsed.data.chargeId,
				parsed.data.reason ?? null,
				event.locals.user
			);
		} catch (e) {
			if (e instanceof FolioError) return fail(400, { folioError: e.message });
			throw e;
		}
		return loadHallDetailPayload(hotelId, parsed.data.hallBookingId);
	},

	hallWalkInCreate: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = hallCreateSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, { hallWalkInError: 'Check the event details and try again.' });
		}
		const d = parsed.data;
		if (d.startTime >= d.endTime) {
			return fail(400, { hallWalkInError: 'End time must be after start time.' });
		}

		try {
			await createWalkInHallBooking({
				hotelId,
				guest: {
					fullName: d.fullName,
					email: d.email,
					phone: d.phone ?? null,
					specialRequests: d.specialRequests ?? null
				},
				functionHallId: d.functionHallId,
				eventDate: d.eventDate,
				startTime: d.startTime,
				endTime: d.endTime,
				eventType: d.eventType,
				guestCount: d.guestCount,
				actor: event.locals.user
			});
			return { hallWalkInOk: 'Function hall booking created.' };
		} catch (e) {
			if (e instanceof HallWalkInError) return fail(400, { hallWalkInError: e.message });
			throw e;
		}
	}
};
