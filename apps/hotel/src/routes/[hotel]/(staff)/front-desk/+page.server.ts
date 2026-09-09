import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { amenityItems, cashAccounts } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { getHallBookingDetail, getRoomBookingDetail } from '$lib/server/reservations';
import { searchAvailability } from '$lib/server/availability';
import {
	FolioError,
	addAmenityItemCharge,
	addExtensionFeeCharge,
	getFolioDetail,
	voidFolioCharge,
	type ExtensionFeeKind,
	type FolioTarget
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
import { FinanceError } from '$lib/server/finance/shared';
import { recordPayment, refundPayment, voidPayment } from '$lib/server/finance/payments';
import { getFinanceSettings } from '$lib/server/finance/settings';
import { getDefaultOpenShift } from '$lib/server/finance/shifts';
import { openShift as openShiftFn } from '$lib/server/finance/shifts';
import { MAX_ROOMS_PER_LINE } from '$lib/pricing-utils';
import { expirePendingOrders } from '$lib/server/orders';
import type { Actions, PageServerLoad } from './$types';

const PAYMENT_METHODS = ['cash', 'card', 'gcash', 'maya', 'bank_transfer', 'cheque'] as const;

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const hotel = locals.hotel!;
	// Release expired unpaid online holds before the room grid is read.
	void expirePendingOrders({ hotelId: hotel.id }).catch((e) =>
		console.error('front-desk: expirePendingOrders failed', e)
	);
	const businessDate = todayInTimezone(hotel.timezone);
	const [grid, hallGrid, amenityItemOptions, financeSettings, openShift, drawers] =
		await Promise.all([
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
				.orderBy(asc(amenityItems.sortOrder), asc(amenityItems.name)),
			getFinanceSettings(hotel.id),
			getDefaultOpenShift(hotel.id),
			db
				.select({ id: cashAccounts.id, name: cashAccounts.name })
				.from(cashAccounts)
				.where(
					and(
						eq(cashAccounts.hotelId, hotel.id),
						eq(cashAccounts.isActive, true),
						eq(cashAccounts.kind, 'cash_drawer')
					)
				)
				.orderBy(asc(cashAccounts.sortOrder), asc(cashAccounts.name))
		]);

	return {
		businessDate,
		checkInTime: hotel.checkInTime,
		checkOutTime: hotel.checkOutTime,
		lateCheckoutFeePerHourCentavos: hotel.lateCheckoutFeePerHourCentavos,
		earlyCheckInFeePerHourCentavos: hotel.earlyCheckInFeePerHourCentavos,
		amenityItemOptions,
		hallGrid,
		role: locals.role,
		cashier: {
			requireOpenShiftForCashPayment: financeSettings.requireOpenShiftForCashPayment,
			hasBankAccount: !!financeSettings.defaultBankAccountId,
			hasDrawerAccount: !!financeSettings.defaultDrawerAccountId || drawers.length > 0,
			drawers,
			openShift: openShift
				? {
						id: openShift.id,
						openedAt: openShift.openedAt,
						openingFloatCentavos: openShift.openingFloatCentavos,
						drawerId: openShift.cashAccountId
					}
				: null
		},
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

/** Cashier payment fields shared by the walk-in forms and the folio "Take payment" dialog. */
const paymentFieldsSchema = z.object({
	method: z.enum(PAYMENT_METHODS),
	tendered: z.coerce.number().min(0).optional(),
	referenceNo: z.string().max(120).optional(),
	bankName: z.string().max(120).optional(),
	chequeDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional()
		.or(z.literal(''))
});

const createSchema = z
	.object({
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
	})
	.merge(paymentFieldsSchema);

const hallCreateSchema = z
	.object({
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
	})
	.merge(paymentFieldsSchema);

const centavos = (pesos: number | undefined) => (pesos == null ? null : Math.round(pesos * 100));

function walkInPaymentFrom(d: z.infer<typeof paymentFieldsSchema>) {
	return {
		method: d.method,
		tenderedCentavos: centavos(d.tendered),
		referenceNo: d.referenceNo || null,
		bankName: d.bankName || null,
		chequeDate: d.chequeDate || null
	};
}

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

	/** Take a payment against a room or hall folio — deposit, partial, or full. */
	recordPayment: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'folio:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z
			.object({
				kind: z.enum(['room', 'hall']),
				id: z.string().uuid(),
				amount: z.coerce.number().positive(),
				cashAccountId: z.string().uuid().optional().or(z.literal(''))
			})
			.merge(paymentFieldsSchema)
			.safeParse(raw);
		if (!parsed.success)
			return fail(400, { folioError: 'Check the payment details and try again.' });
		const d = parsed.data;
		const target: FolioTarget =
			d.kind === 'room' ? { kind: 'room', bookingId: d.id } : { kind: 'hall', hallBookingId: d.id };

		try {
			const res = await recordPayment({
				hotelId,
				target,
				method: d.method,
				amountCentavos: Math.round(d.amount * 100),
				tenderedCentavos: centavos(d.tendered),
				referenceNo: d.referenceNo || null,
				bankName: d.bankName || null,
				chequeDate: d.chequeDate || null,
				cashAccountId: d.cashAccountId || null,
				actor: event.locals.user
			});
			const payload =
				d.kind === 'room'
					? await loadRoomDetailPayload(hotelId, d.id)
					: await loadHallDetailPayload(hotelId, d.id);
			return {
				...payload,
				paymentOk:
					res.changeCentavos > 0
						? `Payment recorded — change ₱${(res.changeCentavos / 100).toFixed(2)}.`
						: res.newBalanceCentavos > 0
							? `₱${(res.appliedCentavos / 100).toFixed(2)} recorded — ₱${(res.newBalanceCentavos / 100).toFixed(2)} still due.`
							: 'Payment recorded — folio settled.'
			};
		} catch (e) {
			if (e instanceof FinanceError || e instanceof FolioError)
				return fail(400, { folioError: e.message });
			throw e;
		}
	},

	voidPayment: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'folio:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z
			.object({
				kind: z.enum(['room', 'hall']),
				id: z.string().uuid(),
				paymentId: z.string().uuid(),
				reason: z.string().max(300).optional()
			})
			.safeParse(raw);
		if (!parsed.success) return fail(400, { folioError: 'Missing payment.' });

		try {
			await voidPayment(
				hotelId,
				parsed.data.paymentId,
				parsed.data.reason ?? null,
				event.locals.user
			);
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { folioError: e.message });
			throw e;
		}
		return parsed.data.kind === 'room'
			? loadRoomDetailPayload(hotelId, parsed.data.id)
			: loadHallDetailPayload(hotelId, parsed.data.id);
	},

	refundPayment: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'folio:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z
			.object({
				kind: z.enum(['room', 'hall']),
				id: z.string().uuid(),
				amount: z.coerce.number().positive(),
				method: z.enum(PAYMENT_METHODS),
				referenceNo: z.string().max(120).optional(),
				reason: z.string().max(300).optional()
			})
			.safeParse(raw);
		if (!parsed.success) return fail(400, { folioError: 'Check the refund details.' });
		const d = parsed.data;
		const target: FolioTarget =
			d.kind === 'room' ? { kind: 'room', bookingId: d.id } : { kind: 'hall', hallBookingId: d.id };

		try {
			await refundPayment({
				hotelId,
				target,
				method: d.method,
				amountCentavos: Math.round(d.amount * 100),
				referenceNo: d.referenceNo || null,
				reason: d.reason || null,
				actor: event.locals.user
			});
		} catch (e) {
			if (e instanceof FinanceError || e instanceof FolioError)
				return fail(400, { folioError: e.message });
			throw e;
		}
		return d.kind === 'room'
			? loadRoomDetailPayload(hotelId, d.id)
			: loadHallDetailPayload(hotelId, d.id);
	},

	voidCharge: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z
			.object({
				bookingId: z.string().uuid(),
				chargeId: z.string().uuid(),
				reason: z.string().max(300).optional()
			})
			.safeParse(raw);
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

	openShift: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'shift:write');
		const hotel = event.locals.hotel!;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z
			.object({
				cashAccountId: z.string().uuid(),
				openingFloat: z.coerce.number().min(0).max(10_000_000)
			})
			.safeParse(raw);
		if (!parsed.success)
			return fail(400, { shiftError: 'Pick a drawer and enter the opening float.' });

		try {
			await openShiftFn({
				hotelId: hotel.id,
				cashAccountId: parsed.data.cashAccountId,
				businessDate: todayInTimezone(hotel.timezone),
				openingFloatCentavos: Math.round(parsed.data.openingFloat * 100),
				actor: event.locals.user
			});
			return { ok: 'Shift opened.' };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { shiftError: e.message });
			throw e;
		}
	},

	checkOut: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotel = event.locals.hotel!;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z
			.object({
				bookingId: z.string().uuid(),
				cityLedger: z.enum(['1']).optional(),
				billToName: z.string().max(160).optional(),
				billToCompany: z.string().max(160).optional(),
				billReference: z.string().max(120).optional(),
				billNotes: z.string().max(500).optional()
			})
			.safeParse(raw);
		if (!parsed.success) return fail(400, { error: 'Missing booking.' });

		const wantsCityLedger = parsed.data.cityLedger === '1';
		if (wantsCityLedger) {
			try {
				requireCap(event.locals.user, event.locals.role, 'hotel:admin');
			} catch {
				return fail(403, { error: 'Only a hotel admin can charge a balance to the city ledger.' });
			}
			if (!parsed.data.billToName?.trim())
				return fail(400, { error: 'Enter who the balance is billed to.' });
		}

		try {
			await checkOutBooking(
				hotel.id,
				parsed.data.bookingId,
				todayInTimezone(hotel.timezone),
				event.locals.user,
				wantsCityLedger
					? {
							billToName: parsed.data.billToName!.trim(),
							billToCompany: parsed.data.billToCompany?.trim() || null,
							referenceNo: parsed.data.billReference?.trim() || null,
							notes: parsed.data.billNotes?.trim() || null
						}
					: undefined
			);
			return {
				checkedOut: true,
				ok: wantsCityLedger
					? 'Checked out — balance moved to the city ledger.'
					: 'Guest checked out.'
			};
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
			return {
				walkInSearch: search,
				availableRoomTypes: [],
				walkInError: 'Check-out must be after check-in.'
			};
		}
		const availableRoomTypes = await searchAvailability({ hotelId, ...search });
		return { walkInSearch: search, availableRoomTypes };
	},

	walkInCreate: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotel = event.locals.hotel!;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = createSchema.safeParse(raw);
		if (!parsed.success) {
			return fail(400, { walkInError: 'Check the guest details and selection and try again.' });
		}
		const d = parsed.data;

		let bookingId: string;
		try {
			const result = await createWalkInBooking({
				hotelId: hotel.id,
				businessDate: todayInTimezone(hotel.timezone),
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
				payment: walkInPaymentFrom(d),
				actor: event.locals.user
			});
			bookingId = result.bookingId;
		} catch (e) {
			if (e instanceof WalkInError || e instanceof FinanceError)
				return fail(400, { walkInError: e.message });
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

	voidHallCharge: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z
			.object({
				hallBookingId: z.string().uuid(),
				chargeId: z.string().uuid(),
				reason: z.string().max(300).optional()
			})
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
		const hotel = event.locals.hotel!;
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
				hotelId: hotel.id,
				businessDate: todayInTimezone(hotel.timezone),
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
				payment: walkInPaymentFrom(d),
				actor: event.locals.user
			});
			return { hallWalkInOk: 'Function hall booking created.' };
		} catch (e) {
			if (e instanceof HallWalkInError || e instanceof FinanceError)
				return fail(400, { hallWalkInError: e.message });
			throw e;
		}
	}
};
