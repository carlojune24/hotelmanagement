import { error, fail } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	bookingRooms,
	bookings,
	folioCharges,
	folios,
	functionHalls,
	guests,
	hallBookings,
	orders,
	paymentAllocations,
	payments,
	receivableEntries,
	receivables,
	roomAssignments,
	roomTypes,
	rooms,
	securityDeposits
} from '$lib/server/db/schema/index';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { FinanceError } from '$lib/server/finance/shared';
import { recordOrderPayment, refundPayment, voidPayment } from '$lib/server/finance/payments';
import { openReceivable } from '$lib/server/finance/receivables';
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

/** A room or hall line counts toward the booking's money once it is a real sale. */
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
		db.select().from(payments).where(eq(payments.orderId, order.id)).orderBy(asc(payments.createdAt)),
		getFinanceSettings(hotel.id),
		getDefaultOpenShift(hotel.id)
	]);

	const lineIds = [...roomRows.map((r) => r.id), ...hallRows.map((h) => h.id)];
	const roomLineIds = roomRows.map((r) => r.id);

	// The booking's city-ledger ACCOUNT(s) and the per-room entries on them.
	const accounts = await db
		.select()
		.from(receivables)
		.where(and(eq(receivables.hotelId, hotel.id), eq(receivables.orderId, order.id)))
		.orderBy(desc(receivables.openedAt));
	const entryRows = accounts.length
		? await db
				.select()
				.from(receivableEntries)
				.where(inArray(receivableEntries.receivableId, accounts.map((a) => a.id)))
				.orderBy(asc(receivableEntries.createdAt))
		: [];
	const accountOf = new Map(accounts.map((a) => [a.id, a]));
	const activeAccount = accounts.find((a) => a.status === 'open' || a.status === 'partial') ?? null;

	// Security deposits are held per ROOM — attach each room's latest one.
	const depositRows =
		roomLineIds.length === 0
			? []
			: await db
					.select()
					.from(securityDeposits)
					.where(
						and(eq(securityDeposits.hotelId, hotel.id), inArray(securityDeposits.bookingId, roomLineIds))
					)
					.orderBy(desc(securityDeposits.createdAt));
	const depositByLine = new Map<string, (typeof depositRows)[number]>();
	for (const d of depositRows)
		if (d.bookingId && !depositByLine.has(d.bookingId)) depositByLine.set(d.bookingId, d);

	const folioRows =
		lineIds.length === 0
			? []
			: await db
					.select({ id: folios.id, bookingId: folios.bookingId, hallBookingId: folios.hallBookingId })
					.from(folios)
					.where(or(inArray(folios.bookingId, lineIds), inArray(folios.hallBookingId, lineIds)));
	const lineOfFolio = new Map(folioRows.map((f) => [f.id, (f.bookingId ?? f.hallBookingId)!]));

	const chargeRows =
		folioRows.length === 0
			? []
			: await db
					.select()
					.from(folioCharges)
					.where(
						inArray(
							folioCharges.folioId,
							folioRows.map((f) => f.id)
						)
					)
					.orderBy(asc(folioCharges.createdAt));
	const chargesByLine = new Map<string, typeof chargeRows>();
	for (const c of chargeRows) {
		const lineId = lineOfFolio.get(c.folioId);
		if (!lineId) continue;
		const arr = chargesByLine.get(lineId) ?? [];
		arr.push(c);
		chargesByLine.set(lineId, arr);
	}

	// Per-room slices of the tagged payments: deposit kept for damage, and balance moved to the city ledger.
	const depositAppliedByLine = new Map<string, number>();
	const cityLedgerByLine = new Map<string, number>();
	for (const p of paymentRows) {
		if (p.status !== 'paid' || p.voidedAt || !p.folioId) continue;
		const lineId = lineOfFolio.get(p.folioId);
		if (!lineId) continue;
		if (p.method === 'security_deposit')
			depositAppliedByLine.set(lineId, (depositAppliedByLine.get(lineId) ?? 0) + p.amountCentavos);
		else if (p.method === 'house_use')
			cityLedgerByLine.set(lineId, (cityLedgerByLine.get(lineId) ?? 0) + p.amountCentavos);
	}

	const chargeView = (lineId: string, total: number, stayLabel: string) => {
		const rows = chargesByLine.get(lineId);
		if (!rows || rows.length === 0) {
			return [
				{
					id: `stay-${lineId}`,
					description: stayLabel,
					quantity: 1,
					totalCentavos: total,
					isBase: true,
					voided: false,
					voidReason: null as string | null
				}
			];
		}
		return rows.map((c) => ({
			id: c.id,
			description: c.description,
			quantity: c.quantity,
			totalCentavos: c.totalCentavos,
			isBase: c.isBaseCharge,
			voided: !!c.voidedAt,
			voidReason: c.voidReason
		}));
	};

	const assigned = await Promise.all(
		roomRows.map((r) =>
			db
				.select({ roomNumber: rooms.roomNumber })
				.from(roomAssignments)
				.innerJoin(rooms, eq(rooms.id, roomAssignments.roomId))
				.where(eq(roomAssignments.bookingRoomId, r.bookingRoomId))
		)
	);
	const ledgerOf = new Map(ledger.lines.map((l) => [l.id, l]));

	const buildLine = (
		base: { id: string; status: string },
		kind: 'room' | 'hall',
		title: string,
		detail: string,
		stay: string
	) => {
		const l = ledgerOf.get(base.id);
		const depositApplied = depositAppliedByLine.get(base.id) ?? 0;
		const cityLedgerMoved = cityLedgerByLine.get(base.id) ?? 0;
		const paid = l?.paidCentavos ?? 0;
		const dep = kind === 'room' ? depositByLine.get(base.id) : undefined;
		return {
			kind,
			id: base.id,
			title,
			detail,
			status: base.status,
			chargesCentavos: l?.chargesCentavos ?? 0,
			charges: chargeView(base.id, l?.chargesCentavos ?? 0, stay),
			depositAppliedCentavos: depositApplied,
			cityLedgerMovedCentavos: cityLedgerMoved,
			/** What this room has been paid in real money (deposit kept and city-ledger moves shown apart). */
			paymentsCentavos: paid - depositApplied - cityLedgerMoved,
			balanceCentavos: l?.balanceCentavos ?? 0,
			deposit: dep
				? {
						status: dep.status,
						amountCentavos: dep.amountCentavos,
						forfeitedCentavos: dep.forfeitedCentavos,
						refundedCentavos: dep.refundedCentavos
					}
				: null,
			cityLedger: entryRows
				.filter((e) => (e.bookingId ?? e.hallBookingId) === base.id)
				.map((e) => {
					const acct = accountOf.get(e.receivableId)!;
					return {
						id: e.id,
						billToName: acct.billToName,
						billToCompany: acct.billToCompany,
						referenceNo: acct.referenceNo,
						amountCentavos: e.amountCentavos,
						status: acct.status,
						openedAt: e.createdAt.toISOString()
					};
				})
		};
	};

	const lines = [
		...roomRows.map((r, i) =>
			buildLine(
				r,
				'room',
				assigned[i]!.length
					? `Room ${assigned[i]!.map((a) => a.roomNumber).join(', ')} · ${r.roomTypeName}`
					: `${r.roomTypeName}${r.quantity > 1 ? ` × ${r.quantity}` : ''}`,
				`${r.checkIn} → ${r.checkOut}`,
				'Room stay'
			)
		),
		...hallRows.map((h) =>
			buildLine(h, 'hall', h.hallName, `${h.eventType} · ${h.eventDate}`, 'Event')
		)
	];

	// The explicit per-room split of each payment (which room got how much).
	const allocRows = paymentRows.length
		? await db
				.select()
				.from(paymentAllocations)
				.where(
					inArray(
						paymentAllocations.paymentId,
						paymentRows.map((p) => p.id)
					)
				)
		: [];
	const titleOf = new Map(lines.map((l) => [l.id, l.title]));
	const allocsByPayment = new Map<
		string,
		{ lineId: string; title: string; amountCentavos: number }[]
	>();
	for (const a of allocRows) {
		const lineId = (a.bookingId ?? a.hallBookingId)!;
		const arr = allocsByPayment.get(a.paymentId) ?? [];
		arr.push({ lineId, title: titleOf.get(lineId) ?? 'Room', amountCentavos: a.amountCentavos });
		allocsByPayment.set(a.paymentId, arr);
	}

	const canCollect = locals.user?.isPlatformAdmin
		? true
		: locals.role
			? roleCan(locals.role.capabilities, 'folio:write')
			: false;
	const canCityLedger = locals.user?.isPlatformAdmin
		? true
		: locals.role
			? roleCan(locals.role.capabilities, 'hotel:admin')
			: false;

	const depositAppliedTotal = lines.reduce((sum, l) => sum + l.depositAppliedCentavos, 0);
	const cityLedgerTotal = lines.reduce((sum, l) => sum + l.cityLedgerMovedCentavos, 0);
	const carrier = lines.find((l) => l.kind === 'room' && LIVE.has(l.status)) ?? lines[0] ?? null;

	return {
		order: {
			id: order.id,
			code: order.id.slice(0, 8).toUpperCase(),
			status: order.status,
			totalCentavos: order.totalCentavos,
			amountDueNowCentavos: order.amountDueNowCentavos
		},
		guest: {
			fullName: guest?.fullName ?? '—',
			email: guest?.email ?? '',
			phone: guest?.phone ?? null
		},
		lines,
		ledger: {
			chargesTotalCentavos: ledger.chargesTotalCentavos,
			paidTotalCentavos: ledger.paidTotalCentavos,
			balanceCentavos: ledger.balanceCentavos,
			depositAppliedTotalCentavos: depositAppliedTotal,
			cityLedgerTotalCentavos: cityLedgerTotal,
			/** Real money received, excluding deposits kept and balances moved to the city ledger. */
			paymentsReceivedCentavos: ledger.paidTotalCentavos - depositAppliedTotal - cityLedgerTotal
		},
		/** Rooms a payment can be split across (live lines, in room order). */
		payableLines: lines
			.filter((l) => LIVE.has(l.status))
			.map((l) => ({
				kind: l.kind,
				id: l.id,
				title: l.title,
				balanceCentavos: l.balanceCentavos
			})),
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
			voidReason: p.voidReason,
			lineTitle: p.folioId ? (titleOf.get(lineOfFolio.get(p.folioId) ?? '') ?? null) : null,
			// The explicit per-room split of this payment, when it has one.
			allocations: allocsByPayment.get(p.id) ?? []
		})),
		carrier: carrier ? { kind: carrier.kind, id: carrier.id } : null,
		canCollect,
		canCityLedger,
		defaultBillTo: guest?.fullName ?? '',
		/** The booking's one city-ledger account, if any: new rooms join it instead of opening another. */
		cityLedgerAccount: accounts.length
			? {
					id: (activeAccount ?? accounts[0]!).id,
					active: !!activeAccount,
					billToName: (activeAccount ?? accounts[0]!).billToName,
					billToCompany: (activeAccount ?? accounts[0]!).billToCompany,
					originalCentavos: accounts.reduce((sum, a) => sum + a.originalAmountCentavos, 0),
					outstandingCentavos: accounts.reduce((sum, a) => sum + a.outstandingCentavos, 0),
					status: (activeAccount ?? accounts[0]!).status
				}
			: null,
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

const allocationsSchema = z
	.array(
		z.object({
			kind: z.enum(['room', 'hall']),
			id: z.string().uuid(),
			amount: z.coerce.number().min(0)
		})
	)
	.min(1);

export const actions: Actions = {
	/** One payment across the booking's rooms — the desk decides how much pays each room. */
	takePayment: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'folio:write');
		const hotelId = event.locals.hotel!.id;
		const order = await loadOrder(hotelId, event.params.orderId);
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = paymentFieldsSchema.safeParse(raw);
		let split: z.infer<typeof allocationsSchema>;
		try {
			split = allocationsSchema.parse(JSON.parse(String(raw.allocationsJson ?? '[]')));
		} catch {
			return fail(400, { error: 'Assign the payment to at least one room.' });
		}
		if (!parsed.success) return fail(400, { error: 'Check the payment details and try again.' });
		const d = parsed.data;

		const allocations: { target: FolioTarget; amountCentavos: number }[] = [];
		for (const a of split) {
			const target = await targetFor(a.kind, a.id, order.id);
			if (!target) return fail(400, { error: 'That room is not part of this booking.' });
			allocations.push({ target, amountCentavos: Math.round(a.amount * 100) });
		}

		try {
			const res = await recordOrderPayment({
				hotelId,
				orderId: order.id,
				method: d.method,
				tenderedCentavos: centavos(d.tendered),
				referenceNo: d.referenceNo || null,
				bankName: d.bankName || null,
				chequeDate: d.chequeDate || null,
				allocations,
				actor: event.locals.user
			});
			return {
				ok:
					res.changeCentavos > 0
						? `Payment recorded — change ₱${(res.changeCentavos / 100).toFixed(2)}.`
						: 'Payment recorded.'
			};
		} catch (e) {
			if (e instanceof FinanceError || e instanceof FolioError)
				return fail(400, { error: e.message });
			throw e;
		}
	},

	/** Move ONE room's bill (or part of it) to the city ledger — the manager override. */
	moveToCityLedger: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotelId = event.locals.hotel!.id;
		const order = await loadOrder(hotelId, event.params.orderId);
		const parsed = z
			.object({
				kind: z.enum(['room', 'hall']),
				id: z.string().uuid(),
				billToName: z.string().trim().max(160).optional(),
				billToCompany: z.string().max(160).optional(),
				referenceNo: z.string().max(120).optional(),
				notes: z.string().max(500).optional(),
				amount: z.coerce.number().positive().optional().or(z.literal(''))
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success)
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the details.' });
		const d = parsed.data;
		const target = await targetFor(d.kind, d.id, order.id);
		if (!target) return fail(400, { error: 'That room is not part of this booking.' });

		try {
			const res = await openReceivable({
				hotelId,
				target,
				billToName: d.billToName || undefined,
				billToCompany: d.billToCompany?.trim() || null,
				referenceNo: d.referenceNo?.trim() || null,
				notes: d.notes?.trim() || null,
				amountCentavos: typeof d.amount === 'number' ? Math.round(d.amount * 100) : undefined,
				actor: event.locals.user
			});
			return {
				ok: res.addedToExisting
					? `₱${(res.amountCentavos / 100).toFixed(2)} added to this booking's city-ledger account.`
					: `₱${(res.amountCentavos / 100).toFixed(2)} of this room's bill moved to the city ledger.`
			};
		} catch (e) {
			if (e instanceof FinanceError || e instanceof FolioError)
				return fail(400, { error: e.message });
			throw e;
		}
	},

	/** Re-split an already-recorded payment across the rooms (a correction — the money and its
	 *  receipt are unchanged; only which room each part pays). */
	reallocatePayment: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'folio:write');
		const hotelId = event.locals.hotel!.id;
		const order = await loadOrder(hotelId, event.params.orderId);
		const raw = Object.fromEntries(await event.request.formData());
		const paymentId = z.string().uuid().safeParse(raw.paymentId);
		let split: z.infer<typeof allocationsSchema>;
		try {
			split = allocationsSchema.parse(JSON.parse(String(raw.allocationsJson ?? '[]')));
		} catch {
			return fail(400, { error: 'Assign the payment to at least one room.' });
		}
		if (!paymentId.success) return fail(400, { error: 'Missing payment.' });

		const [pay] = await db.select().from(payments).where(eq(payments.id, paymentId.data)).limit(1);
		if (!pay || pay.orderId !== order.id)
			return fail(400, { error: 'Payment not found on this booking.' });
		if (pay.status !== 'paid' || pay.voidedAt || pay.amountCentavos <= 0)
			return fail(400, { error: 'Only a live payment can be re-split.' });
		if (pay.method === 'security_deposit' || pay.method === 'house_use')
			return fail(400, { error: 'That entry belongs to one room and cannot be re-split.' });

		const rows: {
			bookingId: string | null;
			hallBookingId: string | null;
			amountCentavos: number;
		}[] = [];
		let sum = 0;
		for (const a of split) {
			const cents = Math.round(a.amount * 100);
			if (cents <= 0) continue;
			const target = await targetFor(a.kind, a.id, order.id);
			if (!target) return fail(400, { error: 'That room is not part of this booking.' });
			sum += cents;
			rows.push({
				bookingId: target.kind === 'room' ? target.bookingId : null,
				hallBookingId: target.kind === 'hall' ? target.hallBookingId : null,
				amountCentavos: cents
			});
		}
		if (sum !== pay.amountCentavos)
			return fail(400, {
				error:
					sum < pay.amountCentavos
						? 'Some of the payment is not assigned to a room yet.'
						: 'More than the payment was assigned to the rooms.'
			});

		await db.transaction(async (tx) => {
			await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, pay.id));
			await tx.insert(paymentAllocations).values(rows.map((r) => ({ paymentId: pay.id, ...r })));
		});
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'order.reallocate_payment',
			entityType: 'order',
			entityId: order.id,
			after: { paymentId: pay.id, allocations: rows }
		});
		return { ok: 'Payment re-split across the rooms.' };
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
		if (!pay || pay.orderId !== order.id)
			return fail(400, { error: 'Payment not found on this booking.' });

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
			if (e instanceof FinanceError || e instanceof FolioError)
				return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Refund recorded.' };
	}
};
