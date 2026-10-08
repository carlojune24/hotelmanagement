import { fail } from '@sveltejs/kit';
import { and, asc, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import {
	bookings,
	diningItems,
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
import { HOLDING_STATUSES, localParts, zonedToUtc } from '$lib/dining-slots';
import type { RequestEvent } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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

	if (!venue) {
		return { venues, venue: null, tables: [], reservations: [], timezone, date, nowLocal };
	}

	const tables = await db
		.select({
			id: diningTables.id,
			name: diningTables.name,
			seats: diningTables.seats,
			area: diningTables.area,
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

	return { venues, venue, tables, reservations, timezone, date, nowLocal };
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
	seats: z.coerce.number().int().min(1, 'A table seats at least 1.').max(40),
	area: z.string().trim().max(40).optional()
});

const isDuplicate = (e: unknown) =>
	(e as { code?: string })?.code === '23505' ||
	(e as { cause?: { code?: string } })?.cause?.code === '23505';

export const actions: Actions = {
	addTable: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const venueId = recordId().safeParse(raw.diningItemId);
		const parsed = tableFields.safeParse({ ...raw, area: raw.area || undefined });
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the table details.' });
		if (!venueId.success) return fail(404, { error: 'Venue not found.' });
		const [venue] = await db
			.select({ id: diningItems.id })
			.from(diningItems)
			.where(and(eq(diningItems.id, venueId.data), eq(diningItems.hotelId, hotelId)))
			.limit(1);
		if (!venue) return fail(404, { error: 'Venue not found.' });

		// Drop the new table in the first free-looking spot: row by row, 6 cells apart.
		const existing = await db
			.select({ x: diningTables.x, y: diningTables.y })
			.from(diningTables)
			.where(and(eq(diningTables.diningItemId, venue.id), eq(diningTables.isActive, true)));
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

		try {
			const [row] = await db
				.insert(diningTables)
				.values({ hotelId, diningItemId: venue.id, ...parsed.data, area: parsed.data.area ?? null, x, y })
				.returning({ id: diningTables.id });
			await writeAudit({
				hotelId,
				actor: event.locals.user,
				action: 'dining_table.create',
				entityType: 'dining_table',
				entityId: row!.id,
				after: parsed.data
			});
		} catch (e) {
			if (isDuplicate(e)) return fail(400, { error: `This venue already has a table called "${parsed.data.name}".` });
			throw e;
		}
		return { ok: `Added table ${parsed.data.name}.` };
	},

	updateTable: async (event) => {
		requireManage(event);
		const hotelId = event.locals.hotel!.id;
		const raw = Object.fromEntries(await event.request.formData());
		const tableId = recordId().safeParse(raw.tableId);
		const parsed = tableFields.safeParse({ ...raw, area: raw.area || undefined });
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message ?? 'Check the table details.' });
		if (!tableId.success) return fail(404, { error: 'Table not found.' });
		try {
			const updated = await db
				.update(diningTables)
				.set({ ...parsed.data, area: parsed.data.area ?? null, updatedAt: new Date() })
				.where(and(eq(diningTables.id, tableId.data), eq(diningTables.hotelId, hotelId)))
				.returning({ id: diningTables.id });
			if (updated.length === 0) return fail(404, { error: 'Table not found.' });
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
			after: parsed.data
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
	}
};
