import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { amenityItems, cashAccounts, roomTypes } from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import { getHallBookingDetail, getRoomBookingDetail } from '$lib/server/reservations';
import {
	getBrowsableRoomType,
	searchAvailability,
	suggestRoomCountForOccupancy
} from '$lib/server/availability';
import {
	FolioError,
	addAdHocCharge,
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
	previewWalkInAvailability,
	setGuestIdPhoto,
	todayInTimezone
} from '$lib/server/front-desk';
import { saveUpload } from '$lib/server/uploads';
import { FinanceError } from '$lib/server/finance/shared';
import { recordPayment, refundPayment, voidPayment } from '$lib/server/finance/payments';
import { sendBookingReviewRequest } from '$lib/server/email/send-booking-review-request';
import {
	reconcileSettledDeposit,
	SecurityDepositError,
	getSecurityDepositForBooking,
	settleSecurityDeposit
} from '$lib/server/security-deposits';
import { getFinanceSettings } from '$lib/server/finance/settings';
import { getDefaultOpenShift } from '$lib/server/finance/shifts';
import { openShift as openShiftFn } from '$lib/server/finance/shifts';
import { MAX_ROOMS_PER_LINE } from '$lib/pricing-utils';
import { expirePendingOrders, listUnpaidHolds } from '$lib/server/orders';
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
	const [
		grid,
		hallGrid,
		amenityItemOptions,
		financeSettings,
		openShift,
		drawers,
		roomTypePolicyRows
	] = await Promise.all([
		getRoomStatusGrid(hotel.id, businessDate, hotel.checkOutTime, hotel.timezone),
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
			.orderBy(asc(cashAccounts.sortOrder), asc(cashAccounts.name)),
		// Occupancy policy per room type, for the front-desk grid's pick mode to run
		// the same pure `resolveOccupancyPlan` solver the guest booking flow uses —
		// live, in the browser, as staff type a guest count, instead of only finding
		// out a party doesn't fit after "Check availability" comes back.
		db
			.select({
				id: roomTypes.id,
				maxOccupancy: roomTypes.maxOccupancy,
				extraBedAllowed: roomTypes.extraBedAllowed,
				maxExtraBeds: roomTypes.maxExtraBeds,
				extraBedCapacity: roomTypes.extraBedCapacity
			})
			.from(roomTypes)
			.where(eq(roomTypes.hotelId, hotel.id))
	]);
	const roomTypePolicies = Object.fromEntries(
		roomTypePolicyRows.map((t) => [
			t.id,
			{
				maxOccupancy: t.maxOccupancy,
				extraBedAllowed: t.extraBedAllowed,
				maxExtraBeds: t.maxExtraBeds ?? 0,
				extraBedCapacity: t.extraBedCapacity
			}
		])
	);

	return {
		businessDate,
		timezone: hotel.timezone,
		checkInTime: hotel.checkInTime,
		checkOutTime: hotel.checkOutTime,
		lateCheckoutFeePerHourCentavos: hotel.lateCheckoutFeePerHourCentavos,
		earlyCheckInFeePerHourCentavos: hotel.earlyCheckInFeePerHourCentavos,
		vatRateBps: hotel.vatRateBps,
		amenityItemOptions,
		hallGrid,
		roomTypePolicies,
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
	const securityDeposit = await getSecurityDepositForBooking(hotelId, bookingId);
	return { roomDetail: detail, folio, securityDeposit };
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

const walkInRoomItemSchema = z
	.object({
		roomTypeId: z.string().uuid(),
		ratePlanId: z.string().uuid(),
		checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		occupancy: z.coerce.number().int().min(1).max(20),
		roomCount: z.coerce.number().int().min(1).max(MAX_ROOMS_PER_LINE),
		// Specific physical rooms picked directly on the grid — see `WalkInRoomItem`'s
		// own doc comment. Absent for a line built from the date-search fallback.
		roomIds: z.array(z.string().uuid()).optional()
	})
	.refine((d) => d.roomIds == null || d.roomIds.length === d.roomCount, {
		message: 'Selected room count does not match.'
	});

/** One grid-picked room tile the front-desk "Select rooms" flow is checking — see
 *  `previewWalkInAvailability`. No `ratePlanId` yet: pick mode selects a room *type*
 *  by clicking a physical tile, and the rate plan is resolved (and chosen) from this
 *  check's own results, not before it. */
const walkInCheckItemSchema = z.object({
	key: z.string(),
	roomTypeId: z.string().uuid(),
	checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	occupancy: z.coerce.number().int().min(1).max(20),
	roomCount: z.coerce.number().int().min(1).max(MAX_ROOMS_PER_LINE)
});

const createSchema = z
	.object({
		fullName: z.string().min(2).max(160),
		email: z.string().email(),
		phone: z.string().max(40).optional(),
		specialRequests: z.string().max(1000).optional(),
		itemsJson: z.string()
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

function walkInPaymentFrom(d: z.infer<typeof paymentFieldsSchema>, allocationsJson?: unknown) {
	// Optional per-room split from the walk-in form (pesos, one per cart line in cart order).
	let allocationsCentavos: number[] | undefined;
	if (typeof allocationsJson === 'string' && allocationsJson) {
		try {
			const arr = z.array(z.coerce.number().min(0)).parse(JSON.parse(allocationsJson));
			allocationsCentavos = arr.map((n) => Math.round(n * 100));
		} catch {
			allocationsCentavos = undefined;
		}
	}
	return {
		allocationsCentavos,
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

	/** Full room-type detail (spec, gallery, amenities) for the "click the room
	 *  name" dialog — same `BrowsableRoomType` shape/query the guest-facing
	 *  undated room page already uses, just rendered in the staff shell instead
	 *  of the Woven Ledger world. */
	roomTypeDetail: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:read');
		const hotelId = event.locals.hotel!.id;
		const raw = await event.request.formData();
		const roomTypeId = raw.get('roomTypeId');
		if (typeof roomTypeId !== 'string') return fail(400, { error: 'Missing room type.' });

		const roomTypeDetail = await getBrowsableRoomType(hotelId, roomTypeId);
		if (!roomTypeDetail) return fail(404, { error: 'Room type not found.' });
		return { roomTypeDetail };
	},

	captureIdPhoto: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = await event.request.formData();
		const bookingId = raw.get('bookingId');
		if (typeof bookingId !== 'string') return fail(400, { idPhotoError: 'Missing booking.' });

		const photo = raw.get('guestIdPhoto');
		if (!(photo instanceof File) || photo.size === 0) {
			return fail(400, { idPhotoError: 'Capture a photo first.' });
		}

		try {
			const url = await saveUpload(hotelId, photo);
			await setGuestIdPhoto(hotelId, bookingId, url, event.locals.user);
		} catch (e) {
			console.error('captureIdPhoto: could not save guest ID photo', bookingId, e);
			return fail(400, {
				...(await loadRoomDetailPayload(hotelId, bookingId)),
				idPhotoError: 'Could not save the photo — try again.'
			});
		}

		return { ...(await loadRoomDetailPayload(hotelId, bookingId)), idPhotoOk: true };
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
			if (e instanceof FolioError) {
				return fail(400, {
					...(await loadRoomDetailPayload(hotelId, parsed.data.bookingId)),
					folioError: e.message
				});
			}
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
			if (e instanceof FolioError) {
				return fail(400, {
					...(await loadRoomDetailPayload(hotelId, parsed.data.bookingId)),
					folioError: e.message
				});
			}
			throw e;
		}
		return loadRoomDetailPayload(hotelId, parsed.data.bookingId);
	},

	addDamageCharge: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z
			.object({
				bookingId: z.string().uuid(),
				description: z.string().trim().min(1).max(300),
				amount: z.coerce.number().positive()
			})
			.safeParse(raw);
		if (!parsed.success) return fail(400, { folioError: 'Enter a description and amount.' });

		try {
			await addAdHocCharge(
				hotelId,
				{ kind: 'room', bookingId: parsed.data.bookingId },
				{
					description: parsed.data.description,
					amountCentavos: Math.round(parsed.data.amount * 100),
					taxable: false
				},
				event.locals.user
			);
		} catch (e) {
			if (e instanceof FolioError) {
				return fail(400, {
					...(await loadRoomDetailPayload(hotelId, parsed.data.bookingId)),
					folioError: e.message
				});
			}
			throw e;
		}
		return loadRoomDetailPayload(hotelId, parsed.data.bookingId);
	},

	settleDeposit: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z.object({ bookingId: z.string().uuid() }).safeParse(raw);
		if (!parsed.success) return fail(400, { folioError: 'Missing booking.' });

		let depositOk: string;
		try {
			const result = await settleSecurityDeposit(
				hotelId,
				parsed.data.bookingId,
				event.locals.user
			);
			if (result.forfeitedCentavos === 0) {
				depositOk = `Deposit refunded in full — ₱${(result.refundedCentavos / 100).toFixed(2)}.`;
			} else if (result.remainingFolioBalanceCentavos > 0) {
				depositOk = `₱${(result.forfeitedCentavos / 100).toFixed(2)} forfeited for damage — the deposit didn't cover it all, ₱${(result.remainingFolioBalanceCentavos / 100).toFixed(2)} still due.`;
			} else {
				depositOk = `₱${(result.forfeitedCentavos / 100).toFixed(2)} forfeited for damage, ₱${(result.refundedCentavos / 100).toFixed(2)} refunded.`;
			}
		} catch (e) {
			if (e instanceof SecurityDepositError) {
				return fail(400, {
					...(await loadRoomDetailPayload(hotelId, parsed.data.bookingId)),
					folioError: e.message
				});
			}
			throw e;
		}
		return { ...(await loadRoomDetailPayload(hotelId, parsed.data.bookingId)), depositOk };
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
			if (e instanceof FinanceError || e instanceof FolioError) {
				const payload =
					d.kind === 'room'
						? await loadRoomDetailPayload(hotelId, d.id)
						: await loadHallDetailPayload(hotelId, d.id);
				return fail(400, { ...payload, folioError: e.message });
			}
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
			if (e instanceof FinanceError) {
				const payload =
					parsed.data.kind === 'room'
						? await loadRoomDetailPayload(hotelId, parsed.data.id)
						: await loadHallDetailPayload(hotelId, parsed.data.id);
				return fail(400, { ...payload, folioError: e.message });
			}
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
			if (e instanceof FinanceError || e instanceof FolioError) {
				const payload =
					d.kind === 'room'
						? await loadRoomDetailPayload(hotelId, d.id)
						: await loadHallDetailPayload(hotelId, d.id);
				return fail(400, { ...payload, folioError: e.message });
			}
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
			if (e instanceof FolioError) {
				return fail(400, {
					...(await loadRoomDetailPayload(hotelId, parsed.data.bookingId)),
					folioError: e.message
				});
			}
			throw e;
		}
		// A deposit already settled against this damage is only kept for damage that stands —
		// voiding the charge releases the now-unjustified part back to the guest.
		let depositOk: string | undefined;
		try {
			const r = await reconcileSettledDeposit(
				hotelId,
				parsed.data.bookingId,
				parsed.data.reason ?? null,
				event.locals.user
			);
			if (r.releasedCentavos > 0) {
				depositOk =
					r.forfeitedCentavos > 0
						? `Charge voided — ₱${(r.releasedCentavos / 100).toFixed(2)} of the deposit released back to the guest (₱${(r.forfeitedCentavos / 100).toFixed(2)} still forfeited).`
						: `Charge voided — the ₱${(r.releasedCentavos / 100).toFixed(2)} forfeited deposit is released back to the guest.`;
			}
		} catch (e) {
			if (e instanceof SecurityDepositError || e instanceof FinanceError) {
				return fail(400, {
					...(await loadRoomDetailPayload(hotelId, parsed.data.bookingId)),
					folioError: `The charge was voided, but the security deposit could not be adjusted: ${e.message}`
				});
			}
			throw e;
		}
		return { ...(await loadRoomDetailPayload(hotelId, parsed.data.bookingId)), depositOk };
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

			// Best-effort guest nudge — never blocks checkout.
			void sendBookingReviewRequest(parsed.data.bookingId).catch((e) =>
				console.error('checkOut: sendBookingReviewRequest failed', parsed.data.bookingId, e)
			);

			return {
				checkedOut: true,
				ok: wantsCityLedger
					? 'Checked out — balance moved to the city ledger.'
					: 'Guest checked out.'
			};
		} catch (e) {
			if (e instanceof CheckOutError) {
				return fail(400, {
					...(await loadRoomDetailPayload(hotel.id, parsed.data.bookingId)),
					error: e.message
				});
			}
			throw e;
		}
	},

	/** The front-desk grid's "Select rooms" pick mode: checks every picked tile's own
	 *  room type against its own dates/occupancy in one round trip, read-only — see
	 *  `previewWalkInAvailability`. The actual booking is still re-verified for real
	 *  inside `createWalkInBooking`'s transaction at submit time. */
	previewWalkIn: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = z.object({ itemsJson: z.string() }).safeParse(raw);
		if (!parsed.success) {
			return fail(400, { walkInPreviewError: 'Select at least one room and try again.' });
		}
		let items: z.infer<typeof walkInCheckItemSchema>[];
		try {
			items = z.array(walkInCheckItemSchema).min(1).parse(JSON.parse(parsed.data.itemsJson));
		} catch {
			return fail(400, { walkInPreviewError: 'Select at least one room and try again.' });
		}
		const walkInPreview = await previewWalkInAvailability(hotelId, items);
		return { walkInPreview };
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
		// Nothing fit even with extra beds — tell staff whether more rooms of some type
		// would actually help, instead of a bare dead end.
		const suggestedRoomCount =
			availableRoomTypes.length === 0
				? await suggestRoomCountForOccupancy(hotelId, search.occupancy, search.roomCount)
				: null;
		// Nothing came back: say if unpaid online checkouts are the reason (they hold rooms until paid or expired).
		const unpaidHolds =
			availableRoomTypes.length === 0
				? await listUnpaidHolds(hotelId, search.checkIn, search.checkOut)
				: [];
		return { walkInSearch: search, availableRoomTypes, suggestedRoomCount, unpaidHolds };
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
		// The room tile staff had selected on the grid before opening the walk-in
		// form — carried through so the reservation page's back link can return
		// here with that same room re-selected, instead of a bare front-desk view.
		const originRoomId = typeof raw.originRoomId === 'string' ? raw.originRoomId : '';

		let items: z.infer<typeof walkInRoomItemSchema>[];
		try {
			items = z.array(walkInRoomItemSchema).min(1).parse(JSON.parse(d.itemsJson));
		} catch {
			return fail(400, {
				walkInError: 'Your walk-in cart looks empty — add a room before continuing.'
			});
		}

		let orderId: string;
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
				rooms: items,
				payment: walkInPaymentFrom(d, raw.allocationsJson),
				actor: event.locals.user
			});
			orderId = result.orderId;
		} catch (e) {
			if (e instanceof WalkInError || e instanceof FinanceError)
				return fail(400, { walkInError: e.message });
			throw e;
		}

		// Lands on the booking's Transaction page (the parent view: every room, the payments and the
		// one balance) rather than the first room's reservation page. Carries the origin room so its
		// back link can return to the front desk with that same room re-selected.
		const backQuery = originRoomId ? `?roomId=${encodeURIComponent(originRoomId)}` : '';
		redirect(303, `/${event.locals.hotel!.slug}/management/transactions/${orderId}${backQuery}`);
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
			if (e instanceof FolioError) {
				return fail(400, {
					...(await loadHallDetailPayload(hotelId, parsed.data.hallBookingId)),
					folioError: e.message
				});
			}
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
			if (e instanceof FolioError) {
				return fail(400, {
					...(await loadHallDetailPayload(hotelId, parsed.data.hallBookingId)),
					folioError: e.message
				});
			}
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
