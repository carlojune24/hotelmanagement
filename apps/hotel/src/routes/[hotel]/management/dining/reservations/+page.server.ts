import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	bookings,
	diningItems,
	diningOrders,
	diningReservations,
	diningReservationTables,
	diningTables
} from '$lib/server/db/schema/index';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { recordId } from '$lib/rate-validation';
import {
	ReservationError,
	addStaffPreOrder,
	createReservation,
	setReservationStatus
} from '$lib/server/dining-reservations';
import { OrderError } from '$lib/server/dining-orders';
import { loadVenueMenu } from '$lib/server/dining-menu';
import { listInHouseGuests } from '$lib/server/dining-room-charge';
import { chargeRoomAction, discountAfterPaymentAction, payOrderAction } from '$lib/server/dining-check-actions';
import { diningDrawerId, diningPayAccountNames } from '$lib/server/finance/payments';
import { getDefaultOpenShift, getOpenShiftForDrawer } from '$lib/server/finance/shifts';
import { localParts, zonedToUtc } from '$lib/dining-slots';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 25;
const TABS = ['today', 'upcoming', 'past', 'cancelled'] as const;
type Tab = (typeof TABS)[number];

const nextDay = (date: string) => {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
};

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotelId = locals.hotel!.id;
	const timezone = locals.hotel!.timezone;

	const venues = await db
		.select({
			id: diningItems.id,
			title: diningItems.title,
			reservationsEnabled: diningItems.reservationsEnabled,
			turnMinutes: diningItems.turnMinutes,
			maxPartySize: diningItems.maxPartySize
		})
		.from(diningItems)
		.where(eq(diningItems.hotelId, hotelId))
		.orderBy(asc(diningItems.sortOrder), asc(diningItems.title));

	const tab = (TABS as readonly string[]).includes(url.searchParams.get('tab') ?? '')
		? (url.searchParams.get('tab') as Tab)
		: 'today';
	const venueId = venues.find((v) => v.id === url.searchParams.get('venue'))?.id ?? null;
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
	const pageNo = Math.max(1, Number(url.searchParams.get('page')) || 1);

	const now = new Date();
	const today = localParts(now, timezone).date;
	const todayStart = zonedToUtc(today, '00:00', timezone);
	const tomorrowStart = zonedToUtc(nextDay(today), '00:00', timezone);

	const base: SQL[] = [eq(diningReservations.hotelId, hotelId)];
	if (venueId) base.push(eq(diningReservations.diningItemId, venueId));
	if (q) {
		const like = `%${q.replace(/[%_]/g, '')}%`;
		base.push(
			or(
				ilike(diningReservations.guestName, like),
				ilike(diningReservations.code, like),
				ilike(diningReservations.guestPhone, like),
				ilike(diningReservations.guestEmail, like)
			)!
		);
	}

	const live = sql`${diningReservations.status} not in ('cancelled','no_show')`;
	const where: Record<Tab, SQL> = {
		today: and(live, gte(diningReservations.startsAt, todayStart), lt(diningReservations.startsAt, tomorrowStart))!,
		upcoming: and(live, gte(diningReservations.startsAt, tomorrowStart))!,
		past: and(live, lt(diningReservations.startsAt, todayStart))!,
		cancelled: sql`${diningReservations.status} in ('cancelled','no_show')`
	};

	const countRow = await db
		.select({
			today: sql<number>`count(*) filter (where ${where.today})`,
			upcoming: sql<number>`count(*) filter (where ${where.upcoming})`,
			past: sql<number>`count(*) filter (where ${where.past})`,
			cancelled: sql<number>`count(*) filter (where ${where.cancelled})`
		})
		.from(diningReservations)
		.where(and(...base));
	const counts = {
		today: Number(countRow[0]?.today ?? 0),
		upcoming: Number(countRow[0]?.upcoming ?? 0),
		past: Number(countRow[0]?.past ?? 0),
		cancelled: Number(countRow[0]?.cancelled ?? 0)
	};

	const rows = await db
		.select({
			id: diningReservations.id,
			code: diningReservations.code,
			status: diningReservations.status,
			guestName: diningReservations.guestName,
			guestPhone: diningReservations.guestPhone,
			guestEmail: diningReservations.guestEmail,
			partySize: diningReservations.partySize,
			startsAt: diningReservations.startsAt,
			remarks: diningReservations.remarks,
			source: diningReservations.source,
			venueId: diningReservations.diningItemId,
			venueTitle: diningItems.title,
			bookingOrderId: bookings.orderId
		})
		.from(diningReservations)
		.innerJoin(diningItems, eq(diningItems.id, diningReservations.diningItemId))
		.leftJoin(bookings, eq(bookings.id, diningReservations.bookingId))
		.where(and(...base, where[tab]))
		.orderBy(tab === 'past' || tab === 'cancelled' ? desc(diningReservations.startsAt) : asc(diningReservations.startsAt))
		.limit(PAGE_SIZE)
		.offset((pageNo - 1) * PAGE_SIZE);

	const links = rows.length
		? await db
				.select({ reservationId: diningReservationTables.reservationId, name: diningTables.name })
				.from(diningReservationTables)
				.innerJoin(diningTables, eq(diningTables.id, diningReservationTables.tableId))
				.where(inArray(diningReservationTables.reservationId, rows.map((r) => r.id)))
		: [];

	// Pre-orders placed against these reservations: what was ordered ahead, and whether it is paid.
	const preOrderRows = rows.length
		? await db
				.select({
					reservationId: diningOrders.reservationId,
					status: diningOrders.status,
					paymentStatus: diningOrders.paymentStatus,
					total: diningOrders.totalCentavos,
					id: diningOrders.id,
					code: diningOrders.code,
					vat: diningOrders.vatCentavos,
					discountKind: diningOrders.discountKind
				})
				.from(diningOrders)
				.where(
					and(
						eq(diningOrders.hotelId, hotelId),
						eq(diningOrders.orderType, 'pre_order'),
						inArray(diningOrders.reservationId, rows.map((r) => r.id))
					)
				)
		: [];

	const allTables = await db		.select({ id: diningTables.id, venueId: diningTables.diningItemId, name: diningTables.name, seats: diningTables.seats })
		.from(diningTables)
		.where(and(eq(diningTables.hotelId, hotelId), eq(diningTables.isActive, true)))
		.orderBy(asc(diningTables.name));

	// What the pre-order menu and the Take payment dialog need (same as the Orders board).
	const can = (cap: string) => !!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, cap));
	const writer = can('dining:write');
	const menus: Record<string, Awaited<ReturnType<typeof loadVenueMenu>>> = {};
	if (writer) {
		for (const v of venues) {
			if (!allTables.some((t) => t.venueId === v.id)) continue;
			const m = await loadVenueMenu(hotelId, v.id);
			if (m.items.length > 0) menus[v.id] = m;
		}
	}
	const drawerId = writer ? await diningDrawerId(hotelId) : null;
	const shift = writer
		? await (drawerId ? getOpenShiftForDrawer(hotelId, drawerId) : getDefaultOpenShift(hotelId)).catch(() => null)
		: null;

	return {
		canWrite: writer,
		/** Senior / PWD after payment refunds money: managers only, like any refund. */
		canManage: can('dining:manage') || can('hotel:admin'),
		menus,
		tables: allTables.filter((t) => menus[t.venueId]),
		vatRateBps: locals.hotel!.vatRateBps,
		shiftOpen: !!shift,
		inHouse: writer ? await listInHouseGuests(hotelId) : [],
		payAccounts: writer ? await diningPayAccountNames(hotelId) : { card: null, gcash: null, maya: null },
		venues,
		venueId,
		tab,
		q,
		page: pageNo,
		pageSize: PAGE_SIZE,
		counts,
		total: counts[tab],
		timezone,
		today,
		nowIso: now.toISOString(),
		allTables,
		rows: rows.map((r) => ({
			id: r.id,
			code: r.code,
			status: r.status,
			guestName: r.guestName,
			guestPhone: r.guestPhone,
			guestEmail: r.guestEmail,
			partySize: r.partySize,
			startsAt: r.startsAt.toISOString(),
			remarks: r.remarks,
			source: r.source,
			venueId: r.venueId,
			venueTitle: r.venueTitle,
			bookingCode: r.bookingOrderId ? r.bookingOrderId.slice(0, 8).toUpperCase() : null,
			tables: links.filter((l) => l.reservationId === r.id).map((l) => l.name),
			preOrder: (() => {
				const mine = preOrderRows.filter((o) => o.reservationId === r.id && o.status !== 'cancelled');
				if (mine.length === 0) return null;
				return {
					/** Orders still to pay, for the Take payment button. */
					unpaid: mine
						.filter((o) => o.paymentStatus === 'unpaid')
						.map((o) => ({ id: o.id, code: o.code, totalCentavos: o.total, vatCentavos: o.vat, guestName: r.guestName, tableLabel: null })),
					/** Paid with no discount yet: a Senior / PWD can still be applied (the difference refunded). */
					discountable: mine
						.filter((o) => o.paymentStatus === 'paid' && !o.discountKind)
						.map((o) => ({ id: o.id, code: o.code, totalCentavos: o.total, vatCentavos: o.vat, guestName: r.guestName })),
					count: mine.length,
					totalCentavos: mine.reduce((s, o) => s + o.total, 0),
					paid: mine.every((o) => o.paymentStatus === 'paid' || o.paymentStatus === 'room_charged'),
					// Where the kitchen is with it: cooking if any order is, ready/served once all are.
					kitchen: mine.some((o) => o.status === 'preparing')
						? 'cooking'
						: mine.every((o) => o.status === 'served')
							? 'served'
							: mine.every((o) => o.status === 'ready' || o.status === 'served')
								? 'ready'
								: null
				};
			})()
		}))
	};
};

const createSchema = z.object({
	diningItemId: recordId(),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
	time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick a time.'),
	partySize: z.coerce.number().int().min(1, 'Enter how many people are dining.').max(100),
	guestName: z.string().trim().min(1, 'Enter the guest name.').max(120),
	guestPhone: z.string().trim().max(40).optional(),
	guestEmail: z.union([z.literal(''), z.string().trim().email('Enter a valid email address.')]).optional(),
	remarks: z.string().trim().max(500).optional(),
	tableId: z.string().uuid().optional()
});

/** Dishes ordered ahead, as the New order menu sends them (JSON). Priced again on the server. */
const preOrderSchema = z.object({
	lines: z
		.array(
			z.object({
				menuItemId: z.string().uuid(),
				quantity: z.number().int().min(1).max(50),
				remarks: z.string().max(300).optional(),
				addonIds: z.array(z.string().uuid()).max(30).optional()
			})
		)
		.min(1)
		.max(40),
	remarks: z.string().trim().max(500).optional()
});
function parsePreOrder(raw: FormDataEntryValue | undefined) {
	if (!raw) return { ok: true as const, value: null };
	try {
		const p = preOrderSchema.safeParse(JSON.parse(String(raw)));
		return p.success ? { ok: true as const, value: p.data } : { ok: false as const };
	} catch {
		return { ok: false as const };
	}
}

export const actions: Actions = {
	create: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const raw = Object.fromEntries(await event.request.formData());
		const parsed = createSchema.safeParse({
			...raw,
			guestPhone: raw.guestPhone || undefined,
			guestEmail: raw.guestEmail || undefined,
			remarks: raw.remarks || undefined,
			tableId: raw.tableId && raw.tableId !== 'auto' ? raw.tableId : undefined
		});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the reservation details.' });
		const d = parsed.data;
		const pre = parsePreOrder(raw.preOrder);
		if (!pre.ok) return fail(400, { error: 'The pre-order could not be read. Pick the dishes again.' });
		try {
			const r = await createReservation({
				hotelId: event.locals.hotel!.id,
				venueId: d.diningItemId,
				timezone: event.locals.hotel!.timezone,
				date: d.date,
				time: d.time,
				partySize: d.partySize,
				guestName: d.guestName,
				guestPhone: d.guestPhone,
				guestEmail: d.guestEmail || null,
				remarks: d.remarks,
				source: 'staff',
				tableIds: d.tableId ? [d.tableId] : undefined,
				actor: event.locals.user
			});
			const booked = `Booked ${d.guestName} at table ${r.tableNames.join(', ')} (${r.code}).`;
			if (!pre.value) return { ok: booked };
			try {
				const order = await addStaffPreOrder({ hotelId: event.locals.hotel!.id, reservationId: r.id, lines: pre.value.lines, remarks: pre.value.remarks, actor: event.locals.user });
				// Full payment comes next, like an online pre-order: the page opens Take payment on it.
				return { ok: `${booked} Take payment for pre-order ${order.code}.`, payOrder: { ...order, tableLabel: null } };
			} catch (e) {
				// All or nothing: a booking whose pre-order failed is not what the guest asked for.
				if (!(e instanceof OrderError)) throw e;
				await setReservationStatus({ hotelId: event.locals.hotel!.id, reservationId: r.id, to: 'cancelled', actor: event.locals.user }).catch(() => {});
				return fail(400, { error: `Not booked: ${e.message}` });
			}
		} catch (e) {
			if (e instanceof ReservationError) return fail(400, { error: e.message });
			throw e;
		}
	},

	/** Dishes ordered ahead for an upcoming reservation (the guest called back). Full payment follows. */
	addPreOrder: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const raw = Object.fromEntries(await event.request.formData());
		const id = z.string().uuid().safeParse(raw.reservationId);
		const pre = parsePreOrder(raw.preOrder);
		if (!id.success || !pre.ok || !pre.value) return fail(400, { error: 'Pick at least one dish.' });
		try {
			const order = await addStaffPreOrder({ hotelId: event.locals.hotel!.id, reservationId: id.data, lines: pre.value.lines, remarks: pre.value.remarks, actor: event.locals.user });
			return { ok: `Pre-order ${order.code} added. Take payment for it.`, payOrder: { ...order, tableLabel: null } };
		} catch (e) {
			if (e instanceof OrderError) return fail(400, { error: e.message });
			throw e;
		}
	},

	/** Take payment / charge to room, from the same dialog the Orders board uses. */
	pay: payOrderAction,
	chargeRoom: chargeRoomAction,
	discountAfterPayment: discountAfterPaymentAction,

	setStatus: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const parsed = z
			.object({
				reservationId: recordId(),
				to: z.enum(['confirmed', 'seated', 'completed', 'no_show', 'cancelled'])
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'That reservation could not be found.' });
		try {
			const r = await setReservationStatus({
				hotelId: event.locals.hotel!.id,
				reservationId: parsed.data.reservationId,
				to: parsed.data.to,
				actor: event.locals.user
			});
			return { ok: `${r.guestName} marked ${parsed.data.to.replace('_', '-')}.` };
		} catch (e) {
			if (e instanceof ReservationError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
