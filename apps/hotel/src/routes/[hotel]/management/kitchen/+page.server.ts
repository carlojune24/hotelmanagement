import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { diningItems, diningOrders, diningReservations, diningReservationTables, diningTables } from '$lib/server/db/schema/index';
import { localParts } from '$lib/dining-slots';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { recordId } from '$lib/rate-validation';
import { listStations } from '$lib/server/dining-menu';
import { OrderError, listBoardOrders, setStationStatus, voidDiningOrder } from '$lib/server/dining-orders';
import { FinanceError } from '$lib/server/finance/shared';
import type { SessionUser } from '$lib/server/auth/session';
import { expirePendingDiningOrders } from '$lib/server/dining-online';
import type { Actions, PageServerLoad } from './$types';

const isBusinessError = (e: unknown) => e instanceof OrderError || e instanceof FinanceError;

/** Voiding an order is for the hotel admin and managers only: Hotel Admin has every permission, and a
 *  manager role is given `dining:void` in the role editor. The Dining and Kitchen roles don't have it. */
const canVoid = (user: SessionUser | null | undefined, role: App.Locals['role']) =>
	!!user?.isPlatformAdmin || (!!role && roleCan(role.capabilities, 'dining:void'));

/** The kitchen sees an order only while it can still be cooked, so served orders are left out. */
export const load: PageServerLoad = async ({ locals, url, depends }) => {
	depends('app:kitchen');
	requireCap(locals.user, locals.role, 'kitchen:read');
	const hotelId = locals.hotel!.id;

	const venues = await db
		.select({ id: diningItems.id, title: diningItems.title, prepMinutes: diningItems.prepMinutes })
		.from(diningItems)
		.where(eq(diningItems.hotelId, hotelId))
		.orderBy(asc(diningItems.sortOrder), asc(diningItems.title));
	const venueId = venues.find((v) => v.id === url.searchParams.get('venue'))?.id ?? null;

	await expirePendingDiningOrders({ hotelId }).catch((e) => console.error('kitchen: expirePendingDiningOrders failed', e));
	// A pre-order for a table that is not due yet stays off the cooks' board until its release time
	// (`dining-hold`); today's ones are listed apart as "coming up" so the kitchen can plan for them.
	const all = await listBoardOrders(hotelId, { venueId, servedSince: new Date(Date.now() + 86_400_000) });
	const orders = all.filter((o) => !o.held && o.status !== 'served');
	const today = localParts(new Date(), locals.hotel!.timezone).date;
	const heldToday = all.filter((o) => o.held && o.pickupAt && localParts(o.pickupAt, locals.hotel!.timezone).date === today);

	// Party size for every pre-order ticket, released or coming up.
	const resIds = [...new Set([...orders, ...heldToday].map((o) => o.reservationId).filter((id): id is string => !!id))];
	const parties = resIds.length
		? await db
				.select({ id: diningReservations.id, partySize: diningReservations.partySize, code: diningReservations.code })
				.from(diningReservations)
				.where(and(eq(diningReservations.hotelId, hotelId), inArray(diningReservations.id, resIds)))
		: [];
	// A pre-order's table is the one held by its reservation (the order itself has none yet).
	const resTables = resIds.length
		? await db
				.select({ reservationId: diningReservationTables.reservationId, name: diningTables.name })
				.from(diningReservationTables)
				.innerJoin(diningTables, eq(diningTables.id, diningReservationTables.tableId))
				.where(inArray(diningReservationTables.reservationId, resIds))
		: [];
	const reservations = Object.fromEntries(
		parties.map((p) => [
			p.id,
			{ partySize: p.partySize, code: p.code, tables: resTables.filter((t) => t.reservationId === p.id).map((t) => t.name).join(', ') || null }
		])
	);
	const prepOf = new Map(venues.map((v) => [v.id, v.prepMinutes]));
	const comingUp = heldToday
		.map((o) => ({
			id: o.id,
			code: o.code,
			tableLabel: o.tableLabel ?? (o.reservationId ? (reservations[o.reservationId]?.tables ?? null) : null),
			guestName: o.guestName,
			seatsAt: o.pickupAt!.toISOString(),
			// When it lands on the board: the same rule as `heldForReservation`.
			fireAt: new Date(o.pickupAt!.getTime() - (prepOf.get(o.venueId) ?? 0) * 60_000).toISOString(),
			partySize: o.reservationId ? (reservations[o.reservationId]?.partySize ?? null) : null,
			items: o.items.map((i) => ({ name: i.name, quantity: i.quantity }))
		}))
		.sort((a, b) => a.fireAt.localeCompare(b.fireAt));

	// Orders cancelled in the last 15 minutes, so a cook who already started one is told to stop.
	const cancelled = await db
		.select({ code: diningOrders.code, at: diningOrders.cancelledAt, tableLabel: diningOrders.tableLabel })
		.from(diningOrders)
		.where(
			and(
				eq(diningOrders.hotelId, hotelId),
				eq(diningOrders.status, 'cancelled'),
				gte(diningOrders.cancelledAt, new Date(Date.now() - 15 * 60_000)),
				venueId ? eq(diningOrders.diningItemId, venueId) : undefined
			)
		)
		.orderBy(desc(diningOrders.cancelledAt))
		.limit(5);

	const stations = (await listStations(hotelId)).map((s) => ({ name: s.name, targetMinutes: s.targetMinutes }));
	return {
		venues,
		venueId,
		orders,
		comingUp,
		reservations,
		cancelled: cancelled.map((c) => ({ code: c.code, tableLabel: c.tableLabel })),
		stations,
		canMove: !!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, 'kitchen:write')),
		canVoid: canVoid(locals.user, locals.role),
		serverNow: Date.now()
	};
};

export const actions: Actions = {
	/**
	 * Start cooking, or mark a ticket ready. Serving stays on the Orders board. With a `station`
	 * only that station's part moves (`__none` = dishes with no station); without one the whole
	 * ticket does. The order is ready once every station is.
	 */
	advance: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'kitchen:write');
		const parsed = z
			.object({ orderId: recordId(), to: z.enum(['preparing', 'ready']), station: z.string().max(80).optional() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'That order could not be found.' });
		try {
			await setStationStatus({
				hotelId: event.locals.hotel!.id,
				orderId: parsed.data.orderId,
				station: parsed.data.station === undefined || parsed.data.station === '' ? undefined : parsed.data.station === '__none' ? null : parsed.data.station,
				to: parsed.data.to,
				actor: event.locals.user
			});
			return { moved: true };
		} catch (e) {
			if (isBusinessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	},

	/** Void (cancel) a food order with a reason. A paid one has its payment reversed or is left for a refund. */
	void: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:void');
		const parsed = z
			.object({ orderId: recordId(), reason: z.string().trim().min(1, 'Give a reason for voiding the order.').max(300) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Give a reason for voiding the order.' });
		try {
			await voidDiningOrder({ hotelId: event.locals.hotel!.id, orderId: parsed.data.orderId, reason: parsed.data.reason, actor: event.locals.user });
			return { voided: true };
		} catch (e) {
			if (isBusinessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	}
};
