import { error, fail } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	bookingRooms,
	bookings,
	functionHalls,
	guests,
	hallBookings,
	orders,
	payments,
	roomAssignments,
	roomTypes,
	rooms
} from '$lib/server/db/schema/index';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { FinanceError } from '$lib/server/finance/shared';
import { recordPayment, refundPayment, voidPayment } from '$lib/server/finance/payments';
import { getFinanceSettings } from '$lib/server/finance/settings';
import { getDefaultOpenShift } from '$lib/server/finance/shifts';
import { FolioError, getOrderIdForTarget, getOrderLedger, type FolioTarget } from '$lib/server/folio';
import type { Actions, PageServerLoad } from './$types';

const PAYMENT_METHODS = ['cash', 'card', 'gcash', 'maya', 'bank_transfer', 'cheque'] as const;

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
const centavos = (pesos: number | undefined) => (pesos == null ? null : Math.round(pesos * 100));

/** A room or hall line counts toward the parent booking's money once it is a real sale. */
const LIVE = new Set(['confirmed', 'checked_in', 'checked_out', 'completed']);

async function loadOrder(hotelId: string, orderId: string) {
	const [order] = await db
		.select()
		.from(orders)
		.where(and(eq(orders.id, orderId), eq(orders.hotelId, hotelId)))
		.limit(1);
	if (!order) error(404, 'Booking not found');
	return order;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'booking:read');
	const hotel = locals.hotel!;
	const order = await loadOrder(hotel.id, params.orderId);

	const [guest] = await db.select().from(guests).where(eq(guests.id, order.guestId)).limit(1);

	const [roomRows, hallRows, ledger, paymentRows, financeSettings, openShift] = await Promise.all([
		db
			.select({
				id: bookings.id,
				status: bookings.status,
				checkIn: bookings.checkIn,
				checkOut: bookings.checkOut,
				quantity: bookingRooms.quantity,
				roomTypeName: roomTypes.name,
				bookingRoomId: bookingRooms.id
			})
			.from(bookings)
			.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
			.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
			.where(eq(bookings.orderId, order.id))
			.orderBy(asc(bookings.createdAt)),
		db
			.select({
				id: hallBookings.id,
				status: hallBookings.status,
				eventDate: hallBookings.eventDate,
				eventType: hallBookings.eventType,
				hallName: functionHalls.name
			})
			.from(hallBookings)
			.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
			.where(eq(hallBookings.orderId, order.id))
			.orderBy(asc(hallBookings.createdAt)),
		getOrderLedger(order.id),
		db
			.select()
			.from(payments)
			.where(eq(payments.orderId, order.id))
			.orderBy(asc(payments.createdAt)),
		getFinanceSettings(hotel.id),
		getDefaultOpenShift(hotel.id)
	]);

	const assigned = await Promise.all(
		roomRows.map((r) =>
			db
				.select({ roomNumber: rooms.roomNumber })
				.from(roomAssignments)
				.innerJoin(rooms, eq(rooms.id, roomAssignments.roomId))
				.where(eq(roomAssignments.bookingRoomId, r.bookingRoomId))
		)
	);
	const chargeOf = new Map(ledger.lines.map((l) => [l.id, l.chargesCentavos]));

	const lines = [
		...roomRows.map((r, i) => ({
			kind: 'room' as const,
			id: r.id,
			title: assigned[i]!.length
				? `Room ${assigned[i]!.map((a) => a.roomNumber).join(', ')} · ${r.roomTypeName}`
				: `${r.roomTypeName}${r.quantity > 1 ? ` × ${r.quantity}` : ''}`,
			detail: `${r.checkIn} → ${r.checkOut}`,
			status: r.status,
			chargesCentavos: chargeOf.get(r.id) ?? 0
		})),
		...hallRows.map((h) => ({
			kind: 'hall' as const,
			id: h.id,
			title: h.hallName,
			detail: `${h.eventType} · ${h.eventDate}`,
			status: h.status,
			chargesCentavos: chargeOf.get(h.id) ?? 0
		}))
	];

	// Payments post through one live line's folio (the ledger is the booking's, so which room
	// carries the row doesn't change any figure) — prefer a room that is still in play.
	const carrier = lines.find((l) => LIVE.has(l.status)) ?? lines[0] ?? null;

	const canCollect = locals.user?.isPlatformAdmin
		? true
		: locals.role
			? roleCan(locals.role.capabilities, 'folio:write')
			: false;

	return {
		order: {
			id: order.id,
			code: order.id.slice(0, 8).toUpperCase(),
			status: order.status,
			totalCentavos: order.totalCentavos,
			amountDueNowCentavos: order.amountDueNowCentavos
		},
		guest: { fullName: guest?.fullName ?? '—', email: guest?.email ?? '', phone: guest?.phone ?? null },
		lines,
		ledger: {
			chargesTotalCentavos: ledger.chargesTotalCentavos,
			paidTotalCentavos: ledger.paidTotalCentavos,
			balanceCentavos: ledger.balanceCentavos
		},
		payments: paymentRows.map((p) => ({
			id: p.id,
			method: p.method,
			purpose: p.purpose,
			status: p.status,
			provider: p.provider,
			amountCentavos: p.amountCentavos,
			referenceNo: p.referenceNo,
			tenderedCentavos: p.tenderedCentavos,
			changeCentavos: p.changeCentavos,
			paidAt: p.paidAt ? p.paidAt.toISOString() : null,
			voidedAt: p.voidedAt ? p.voidedAt.toISOString() : null,
			voidReason: p.voidReason
		})),
		carrier: carrier ? { kind: carrier.kind, id: carrier.id } : null,
		canCollect,
		cashier: {
			requireOpenShiftForCashPayment: financeSettings.requireOpenShiftForCashPayment,
			hasBankAccount: !!financeSettings.defaultBankAccountId,
			openShift: openShift ? { id: openShift.id, drawerId: openShift.cashAccountId } : null
		}
	};
};

/** The posted line must really belong to THIS booking — never trust a client-supplied id. */
async function targetFor(
	kind: 'room' | 'hall',
	id: string,
	orderId: string
): Promise<FolioTarget | null> {
	const target: FolioTarget =
		kind === 'room' ? { kind: 'room', bookingId: id } : { kind: 'hall', hallBookingId: id };
	return (await getOrderIdForTarget(target)) === orderId ? target : null;
}

export const actions: Actions = {
	/** One payment for the whole booking — the ledger is the order's, so no per-room split. */
	recordPayment: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'folio:write');
		const hotelId = event.locals.hotel!.id;
		const order = await loadOrder(hotelId, event.params.orderId);
		const parsed = z
			.object({
				kind: z.enum(['room', 'hall']),
				id: z.string().uuid(),
				amount: z.coerce.number().positive(),
				cashAccountId: z.string().uuid().optional().or(z.literal(''))
			})
			.merge(paymentFieldsSchema)
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the payment details and try again.' });
		const d = parsed.data;
		const target = await targetFor(d.kind, d.id, order.id);
		if (!target) return fail(400, { error: 'That room is not part of this booking.' });

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
			return {
				ok:
					res.changeCentavos > 0
						? `Payment recorded — change ₱${(res.changeCentavos / 100).toFixed(2)}.`
						: res.newBalanceCentavos > 0
							? `₱${(res.appliedCentavos / 100).toFixed(2)} recorded — ₱${(res.newBalanceCentavos / 100).toFixed(2)} still due on this booking.`
							: 'Payment recorded — booking settled.'
			};
		} catch (e) {
			if (e instanceof FinanceError || e instanceof FolioError) return fail(400, { error: e.message });
			throw e;
		}
	},

	voidPayment: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'folio:write');
		const hotelId = event.locals.hotel!.id;
		const order = await loadOrder(hotelId, event.params.orderId);
		const parsed = z
			.object({ paymentId: z.string().uuid(), reason: z.string().max(300).optional() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Missing payment.' });

		const [pay] = await db
			.select({ orderId: payments.orderId })
			.from(payments)
			.where(eq(payments.id, parsed.data.paymentId))
			.limit(1);
		if (!pay || pay.orderId !== order.id) return fail(400, { error: 'Payment not found on this booking.' });

		try {
			await voidPayment(hotelId, parsed.data.paymentId, parsed.data.reason ?? null, event.locals.user);
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Payment voided.' };
	},

	refundPayment: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'folio:write');
		const hotelId = event.locals.hotel!.id;
		const order = await loadOrder(hotelId, event.params.orderId);
		const parsed = z
			.object({
				kind: z.enum(['room', 'hall']),
				id: z.string().uuid(),
				amount: z.coerce.number().positive(),
				method: z.enum(PAYMENT_METHODS),
				referenceNo: z.string().max(120).optional(),
				reason: z.string().max(300).optional()
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Check the refund details.' });
		const d = parsed.data;
		const target = await targetFor(d.kind, d.id, order.id);
		if (!target) return fail(400, { error: 'That room is not part of this booking.' });

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
			if (e instanceof FinanceError || e instanceof FolioError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Refund recorded.' };
	}
};
