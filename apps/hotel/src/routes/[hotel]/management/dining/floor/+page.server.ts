import { fail } from '@sveltejs/kit';
import { and, asc, count, eq, gt, inArray, lt, max, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	bookings,
	diningAreas,
	diningItems,
	diningOrders,
	diningReservations,
	diningReservationTables,
	diningTables
} from '$lib/server/db/schema/index';
import { roleCan } from '$lib/authz';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { recordId } from '$lib/rate-validation';
import {
	ReservationError,
	reassignReservationTables,
	setReservationStatus
} from '$lib/server/dining-reservations';
import { OrderError, setDiningOrderStatus } from '$lib/server/dining-orders';
import {
	forceClearCheck,
	getOpenCheckForTable,
	listOpenChecks,
	requestBill,
} from '$lib/server/dining-checks';
import { closeTableAction, settleTableAction } from '$lib/server/dining-check-actions';
import { listInHouseGuests } from '$lib/server/dining-room-charge';
import { FinanceError } from '$lib/server/finance/shared';
import { getDefaultOpenShift } from '$lib/server/finance/shifts';
import { HOLDING_STATUSES, localParts, zonedToUtc } from '$lib/dining-slots';
import type { RequestEvent } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (date: string) => {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
};

export const load: PageServerLoad = async ({ locals, url, depends }) => {
	depends('app:dining-floor');
	requireCap(locals.user, locals.role, 'dining:read');
	const hotelId = locals.hotel!.id;
	const timezone = locals.hotel!.timezone;
	const can = (cap: string) =>
		!!locals.user?.isPlatformAdmin || (!!locals.role && roleCan(locals.role.capabilities, cap));

	const venues = await db
		.select({
			id: diningItems.id,
			title: diningItems.title,
			isActive: diningItems.isActive,
			turnMinutes: diningItems.turnMinutes
		})
		.from(diningItems)
		.where(eq(diningItems.hotelId, hotelId))
		.orderBy(asc(diningItems.sortOrder), asc(diningItems.title));

	const venue = venues.find((v) => v.id === url.searchParams.get('venue')) ?? venues[0] ?? null;
	const nowLocal = localParts(new Date(), timezone);
	const requestedDate = url.searchParams.get('date') ?? '';
	const date = DATE_RE.test(requestedDate) ? requestedDate : nowLocal.date;

	const common = {
		timezone,
		date,
		nowLocal,
		canWrite: can('dining:write'),
		canClear: can('dining:manage') || can('hotel:admin')
	};
	if (!venue) {
		return { venues, venue: null, areas: [], tables: [], reservations: [], checks: [], awaiting: {} as Record<string, number>, inHouse: [], shiftOpen: false, ...common };
	}

	const areas = await db
		.select({ id: diningAreas.id, name: diningAreas.name, sortOrder: diningAreas.sortOrder })
		.from(diningAreas)
		.where(and(eq(diningAreas.hotelId, hotelId), eq(diningAreas.diningItemId, venue.id)))
		.orderBy(asc(diningAreas.sortOrder), asc(diningAreas.name));

	const tables = await db
		.select({
			id: diningTables.id,
			name: diningTables.name,
			seats: diningTables.seats,
			areaId: diningTables.areaId,
			x: diningTables.x,
			y: diningTables.y
		})
		.from(diningTables)
		.where(
			and(
				eq(diningTables.hotelId, hotelId),
				eq(diningTables.diningItemId, venue.id),
				eq(diningTables.isActive, true)
			)
		)
		.orderBy(asc(diningTables.name));

	// The day's reservations that still matter on the plan (not cancelled / no-show).
	const dayStart = zonedToUtc(date, '00:00', timezone);
	const dayEnd = zonedToUtc(nextDay(date), '00:00', timezone);
	const rows = await db
		.select({
			id: diningReservations.id,
			code: diningReservations.code,
			status: diningReservations.status,
			guestName: diningReservations.guestName,
			guestPhone: diningReservations.guestPhone,
			partySize: diningReservations.partySize,
			startsAt: diningReservations.startsAt,
			endsAt: diningReservations.endsAt,
			remarks: diningReservations.remarks,
			bookingOrderId: bookings.orderId
		})
		.from(diningReservations)
		.leftJoin(bookings, eq(bookings.id, diningReservations.bookingId))
		.where(
			and(
				eq(diningReservations.hotelId, hotelId),
				eq(diningReservations.diningItemId, venue.id),
				ne(diningReservations.status, 'cancelled'),
				ne(diningReservations.status, 'no_show'),
				lt(diningReservations.startsAt, dayEnd),
				gt(diningReservations.endsAt, dayStart)
			)
		)
		.orderBy(asc(diningReservations.startsAt));

	const links = rows.length
		? await db
				.select()
				.from(diningReservationTables)
				.where(inArray(diningReservationTables.reservationId, rows.map((r) => r.id)))
		: [];

	const reservations = rows.map((r) => ({
		id: r.id,
		code: r.code,
		status: r.status,
		guestName: r.guestName,
		guestPhone: r.guestPhone,
		partySize: r.partySize,
		startsAt: r.startsAt.toISOString(),
		endsAt: r.endsAt.toISOString(),
		remarks: r.remarks,
		bookingCode: r.bookingOrderId ? r.bookingOrderId.slice(0, 8).toUpperCase() : null,
		tableIds: links.filter((l) => l.reservationId === r.id).map((l) => l.tableId)
	}));

	// Live, whatever date is being viewed: a table is occupied while its check is open.
	const checks = (await listOpenChecks(hotelId, venue.id)).map((c) => ({
		...c,
		openedAt: c.openedAt.toISOString(),
		billRequestedAt: c.billRequestedAt?.toISOString() ?? null
	}));

	// Table-QR orders waiting for a waiter, per table.
	const pending = await db
		.select({ tableId: diningOrders.tableId, n: count() })
		.from(diningOrders)
		.where(and(eq(diningOrders.hotelId, hotelId), eq(diningOrders.diningItemId, venue.id), eq(diningOrders.status, 'pending_acceptance')))
		.groupBy(diningOrders.tableId);
	const awaiting: Record<string, number> = {};
	for (const p of pending) if (p.tableId) awaiting[p.tableId] = Number(p.n);

	const writer = can('dining:write');
	const shift = writer ? await getDefaultOpenShift(hotelId).catch(() => null) : null;
	const inHouse = writer ? await listInHouseGuests(hotelId).catch(() => []) : [];

	return { venues, venue, areas, tables, reservations, checks, awaiting, inHouse, shiftOpen: !!shift, ...common };
};

/** Editing the layout needs `dining:manage` (hotel admins also qualify through `hotel:admin`). */
function requireManage(event: RequestEvent) {
	const { user, role } = event.locals;
	if (user?.isPlatformAdmin) return;
	if (role && roleCan(role.capabilities, 'hotel:admin')) return;
	requireCap(user, role, 'dining:manage');
}

const GRID_COLS = 30;

const tableFields = z.object({
	name: z.string().trim().min(1, 'Give the table a name.').max(30),
	seats: z.coerce.number().int().min(1, 'A table seats at least 1.').max(40)
});

const areaName = z.string().trim().min(1, 'Give the area a name.').max(40);

const isDuplicate = (e: unknown) =>
	(e as { code?: string })?.code === '23505' ||
	(e as { cause?: { code?: string } })?.cause?.code === '23505';

/** A free-looking spot in an area: row by row, 7 cells across and 6 down. */
async function freeSpot(areaId: string | null, venueId: string) {
	const existing = await db
		.select({ x: diningTables.x, y: diningTables.y })
		.from(diningTables)
		.where(
			and(
				eq(diningTables.diningItemId, venueId),
				eq(diningTables.isActive, true),
				areaId ? eq(diningTables.areaId, areaId) : sql`${diningTables.areaId} is null`
			)
		);
	const taken = new Set(existing.map((t) => `${t.x},${t.y}`));
	let x = 1;
	let y = 1;
	while (taken.has(`${x},${y}`)) {
		x += 7;
		if (x > GRID_COLS - 7) {
			x = 1;
			y += 6;
		}
	}
	return { x, y };
}

/** Confirms an area belongs to this hotel and venue. */
async function areaOf(hotelId: string, venueId: string, areaId: string) {
	const [a] = await db
		.select({ id: diningAreas.id })
		.from(diningAreas)
		.where(and(eq(diningAreas.id, areaId), eq(diningAreas.hotelId, hotelId), eq(diningAreas.diningItemId, venueId)))
		.limit(1);
	return a ?? null;
}

const businessError = (e: unknown) => e instanceof OrderError || e instanceof FinanceError;

export const actions: Actions = {
	// ---- areas ---------------------------------------------------------------------------
	addArea: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ diningItemId: recordId(), name: areaName })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Give the area a name.' });
		const [venue] = await db
			.select({ id: diningItems.id })
			.from(diningItems)
			.where(and(eq(diningItems.id, parsed.data.diningItemId), eq(diningItems.hotelId, hotelId)))
			.limit(1);
		if (!venue) return fail(404, { error: 'Venue not found.' });
		try {
			const [last] = await db
				.select({ n: max(diningAreas.sortOrder) })
				.from(diningAreas)
				.where(eq(diningAreas.diningItemId, venue.id));
			const [row] = await db
				.insert(diningAreas)
				.values({ hotelId, diningItemId: venue.id, name: parsed.data.name, sortOrder: (last?.n ?? -1) + 1 })
				.returning({ id: diningAreas.id });
			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'dining_area.create',
				entityType: 'dining_area',
				entityId: row!.id,
				after: { name: parsed.data.name }
			});
			return { ok: `Added area ${parsed.data.name}.`, areaId: row!.id };
		} catch (e) {
			if (isDuplicate(e)) return fail(400, { error: `This venue already has an area called "${parsed.data.name}".` });
			throw e;
		}
	},

	renameArea: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ areaId: recordId(), name: areaName })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Give the area a name.' });
		try {
			const updated = await db
				.update(diningAreas)
				.set({ name: parsed.data.name, updatedAt: new Date() })
				.where(and(eq(diningAreas.id, parsed.data.areaId), eq(diningAreas.hotelId, hotelId)))
				.returning({ id: diningAreas.id });
			if (updated.length === 0) return fail(404, { error: 'Area not found.' });
		} catch (e) {
			if (isDuplicate(e)) return fail(400, { error: `This venue already has an area called "${parsed.data.name}".` });
			throw e;
		}
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_area.update',
			entityType: 'dining_area',
			entityId: parsed.data.areaId,
			after: { name: parsed.data.name }
		});
		return { ok: 'Area renamed.' };
	},

	/** Swaps an area with its neighbour so the tabs read in the order staff want. */
	moveArea: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ areaId: recordId(), dir: z.enum(['up', 'down']) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Area not found.' });
		const [area] = await db
			.select()
			.from(diningAreas)
			.where(and(eq(diningAreas.id, parsed.data.areaId), eq(diningAreas.hotelId, hotelId)))
			.limit(1);
		if (!area) return fail(404, { error: 'Area not found.' });
		const siblings = await db
			.select({ id: diningAreas.id })
			.from(diningAreas)
			.where(eq(diningAreas.diningItemId, area.diningItemId))
			.orderBy(asc(diningAreas.sortOrder), asc(diningAreas.name));
		const ids = siblings.map((s) => s.id);
		const i = ids.indexOf(area.id);
		const j = parsed.data.dir === 'up' ? i - 1 : i + 1;
		if (j < 0 || j >= ids.length) return { moved: true };
		[ids[i], ids[j]] = [ids[j]!, ids[i]!];
		await db.transaction(async (tx) => {
			for (const [order, id] of ids.entries()) {
				await tx.update(diningAreas).set({ sortOrder: order }).where(eq(diningAreas.id, id));
			}
		});
		return { moved: true };
	},

	deleteArea: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ areaId: recordId() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(404, { error: 'Area not found.' });
		const [inUse] = await db
			.select({ id: diningTables.id })
			.from(diningTables)
			.where(and(eq(diningTables.areaId, parsed.data.areaId), eq(diningTables.hotelId, hotelId), eq(diningTables.isActive, true)))
			.limit(1);
		if (inUse) return fail(400, { error: 'This area still has tables. Move or remove them first.' });
		const deleted = await db
			.delete(diningAreas)
			.where(and(eq(diningAreas.id, parsed.data.areaId), eq(diningAreas.hotelId, hotelId)))
			.returning({ name: diningAreas.name });
		if (deleted.length === 0) return fail(404, { error: 'Area not found.' });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_area.delete',
			entityType: 'dining_area',
			entityId: parsed.data.areaId
		});
		return { ok: `Removed area ${deleted[0]!.name}.` };
	},

	// ---- tables --------------------------------------------------------------------------
	addTable: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const venueId = recordId().safeParse(raw.diningItemId);
		const parsed = tableFields.safeParse(raw);
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the table details.' });
		if (!venueId.success) return fail(404, { error: 'Venue not found.' });
		const [venue] = await db
			.select({ id: diningItems.id })
			.from(diningItems)
			.where(and(eq(diningItems.id, venueId.data), eq(diningItems.hotelId, hotelId)))
			.limit(1);
		if (!venue) return fail(404, { error: 'Venue not found.' });

		// A venue with no areas yet gets a "Main" one, so every table has a home.
		let areaId: string | null = null;
		const requested = recordId().safeParse(raw.areaId);
		if (requested.success) {
			if (!(await areaOf(hotelId, venue.id, requested.data))) return fail(404, { error: 'Area not found.' });
			areaId = requested.data;
		} else {
			const [first] = await db
				.select({ id: diningAreas.id })
				.from(diningAreas)
				.where(eq(diningAreas.diningItemId, venue.id))
				.orderBy(asc(diningAreas.sortOrder))
				.limit(1);
			if (first) areaId = first.id;
			else {
				const [made] = await db
					.insert(diningAreas)
					.values({ hotelId, diningItemId: venue.id, name: 'Main', sortOrder: 0 })
					.onConflictDoNothing()
					.returning({ id: diningAreas.id });
				areaId =
					made?.id ??
					(await db.select({ id: diningAreas.id }).from(diningAreas).where(and(eq(diningAreas.diningItemId, venue.id), eq(diningAreas.name, 'Main'))).limit(1))[0]?.id ??
					null;
			}
		}

		const { x, y } = await freeSpot(areaId, venue.id);
		try {
			const [row] = await db
				.insert(diningTables)
				.values({ hotelId, diningItemId: venue.id, ...parsed.data, areaId, x, y })
				.returning({ id: diningTables.id });
			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'dining_table.create',
				entityType: 'dining_table',
				entityId: row!.id,
				after: { ...parsed.data, areaId }
			});
		} catch (e) {
			if (isDuplicate(e)) return fail(400, { error: `This venue already has a table called "${parsed.data.name}".` });
			throw e;
		}
		return { ok: `Added table ${parsed.data.name}.`, areaId };
	},

	updateTable: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const tableId = recordId().safeParse(raw.tableId);
		const parsed = tableFields.safeParse(raw);
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the table details.' });
		if (!tableId.success) return fail(404, { error: 'Table not found.' });
		const [current] = await db
			.select({ diningItemId: diningTables.diningItemId, areaId: diningTables.areaId })
			.from(diningTables)
			.where(and(eq(diningTables.id, tableId.data), eq(diningTables.hotelId, hotelId)))
			.limit(1);
		if (!current) return fail(404, { error: 'Table not found.' });

		let areaId = current.areaId;
		const requested = recordId().safeParse(raw.areaId);
		let position: { x: number; y: number } | null = null;
		if (requested.success && requested.data !== current.areaId) {
			if (!(await areaOf(hotelId, current.diningItemId, requested.data))) return fail(404, { error: 'Area not found.' });
			areaId = requested.data;
			position = await freeSpot(areaId, current.diningItemId);
		}
		try {
			await db
				.update(diningTables)
				.set({ ...parsed.data, areaId, ...(position ?? {}), updatedAt: new Date() })
				.where(and(eq(diningTables.id, tableId.data), eq(diningTables.hotelId, hotelId)));
		} catch (e) {
			if (isDuplicate(e)) return fail(400, { error: `This venue already has a table called "${parsed.data.name}".` });
			throw e;
		}
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_table.update',
			entityType: 'dining_table',
			entityId: tableId.data,
			after: { ...parsed.data, areaId }
		});
		return { ok: `Updated table ${parsed.data.name}.` };
	},

	/** Saves a dragged position. Called with fetch on drop, so it returns quietly. */
	moveTable: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({
				tableId: recordId(),
				x: z.coerce.number().int().min(0).max(GRID_COLS),
				y: z.coerce.number().int().min(0).max(60)
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'That position is not valid.' });
		const updated = await db
			.update(diningTables)
			.set({ x: parsed.data.x, y: parsed.data.y, updatedAt: new Date() })
			.where(and(eq(diningTables.id, parsed.data.tableId), eq(diningTables.hotelId, hotelId)))
			.returning({ id: diningTables.id });
		if (updated.length === 0) return fail(404, { error: 'Table not found.' });
		return { moved: true };
	},

	deleteTable: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const parsed = z
			.object({ tableId: recordId() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(404, { error: 'Table not found.' });

		// A table that still holds a live reservation can't just vanish from under it.
		const [held] = await db
			.select({ id: diningReservations.id })
			.from(diningReservationTables)
			.innerJoin(diningReservations, eq(diningReservations.id, diningReservationTables.reservationId))
			.where(
				and(
					eq(diningReservationTables.tableId, parsed.data.tableId),
					eq(diningReservations.hotelId, hotelId),
					inArray(diningReservations.status, [...HOLDING_STATUSES]),
					gt(diningReservations.endsAt, new Date())
				)
			)
			.limit(1);
		if (held) {
			return fail(400, { error: 'This table has upcoming reservations. Move or cancel them first.' });
		}
		if (await getOpenCheckForTable(hotelId, parsed.data.tableId)) {
			return fail(400, { error: 'Guests are still seated here. Settle and close the table first.' });
		}

		// Soft retire: past reservations keep pointing at the table's name.
		const retired = await db
			.update(diningTables)
			.set({ isActive: false, updatedAt: new Date() })
			.where(and(eq(diningTables.id, parsed.data.tableId), eq(diningTables.hotelId, hotelId)))
			.returning({ name: diningTables.name });
		if (retired.length === 0) return fail(404, { error: 'Table not found.' });
		await writeAudit({
			hotelId,
			actor: event.locals.user,
			action: 'dining_table.delete',
			entityType: 'dining_table',
			entityId: parsed.data.tableId
		});
		return { ok: `Removed table ${retired[0]!.name}.` };
	},

	// ---- reservations ---------------------------------------------------------------------
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
	},

	changeTable: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const parsed = z
			.object({ reservationId: recordId(), tableId: recordId() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Pick a table.' });
		try {
			await reassignReservationTables({
				hotelId: event.locals.hotel!.id,
				reservationId: parsed.data.reservationId,
				tableIds: [parsed.data.tableId],
				actor: event.locals.user
			});
			return { ok: 'Table changed.' };
		} catch (e) {
			if (e instanceof ReservationError) return fail(400, { error: e.message });
			throw e;
		}
	},

	// ---- the table's check -----------------------------------------------------------------
	/** Pays every unpaid order on the table at once, and frees the table when all is served. */
	settle: settleTableAction,

	/** Frees a table whose orders are all served and paid. */
	closeTable: closeTableAction,

	/** A manager clears a table that cannot be settled normally. */
	forceClear: async (event) => {
		requireManage(event);
		const parsed = z
			.object({ checkId: recordId(), reason: z.string().trim().min(1, 'Give a reason.').max(300) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Give a reason.' });
		try {
			await forceClearCheck({
				hotelId: event.locals.hotel!.id,
				checkId: parsed.data.checkId,
				reason: parsed.data.reason,
				actor: event.locals.user
			});
			return { ok: 'The table was cleared.' };
		} catch (e) {
			if (businessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	},

	/** Floor staff take a ready order to the table and mark it served. The kitchen alone marks it ready. */
	serve: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const parsed = z.object({ orderId: recordId() }).safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'That order could not be found.' });
		try {
			const o = await setDiningOrderStatus({
				hotelId: event.locals.hotel!.id,
				orderId: parsed.data.orderId,
				to: 'served',
				actor: event.locals.user
			});
			return { ok: `Order ${o.code} served.` };
		} catch (e) {
			if (businessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	},

	/** A waiter marks that the table has asked for the bill. */
	billRequested: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dining:write');
		const parsed = z
			.object({ checkId: recordId() })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'That table could not be found.' });
		try {
			await requestBill({ hotelId: event.locals.hotel!.id, checkId: parsed.data.checkId, actor: event.locals.user });
			return { ok: 'Marked as asking for the bill.' };
		} catch (e) {
			if (businessError(e)) return fail(400, { error: (e as Error).message });
			throw e;
		}
	}
};
