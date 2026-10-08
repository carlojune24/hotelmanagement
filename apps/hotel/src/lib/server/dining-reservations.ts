import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { db } from './db/index';
import {
	diningItems,
	diningReservations,
	diningReservationTables,
	diningTables,
	type DiningReservation,
	type DiningReservationStatus,
	type DiningTable
} from './db/schema/index';
import { writeAudit } from './audit';
import {
	HOLDING_STATUSES,
	availableSlots,
	bestTable,
	bookablePartyCap,
	canTransition,
	freeTables,
	listSlots,
	localParts,
	zonedToUtc,
	type BusyHold,
	type SlotAvailability,
	type SlotConfig
} from '../dining-slots';

/** A rule or conflict the caller should show to the user (not a bug). */
export class ReservationError extends Error {}

type Actor = Parameters<typeof writeAudit>[0]['actor'];

export interface BookableVenue {
	id: string;
	title: string;
	reservationsEnabled: boolean;
	cfg: SlotConfig | null;
	tables: Pick<DiningTable, 'id' | 'name' | 'seats' | 'area' | 'x' | 'y'>[];
	/** Largest party that can actually be seated (venue max, capped by the biggest table). */
	partyCap: number;
}

/** A venue's reservation settings and active tables. `cfg` is null until seating hours are set. */
export async function loadBookableVenue(hotelId: string, venueId: string): Promise<BookableVenue | null> {
	const [venue] = await db
		.select()
		.from(diningItems)
		.where(and(eq(diningItems.id, venueId), eq(diningItems.hotelId, hotelId)))
		.limit(1);
	if (!venue) return null;

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
				eq(diningTables.diningItemId, venueId),
				eq(diningTables.isActive, true)
			)
		)
		.orderBy(asc(diningTables.name));

	const cfg: SlotConfig | null =
		venue.seatingOpen && venue.lastSeating
			? {
					seatingOpen: venue.seatingOpen,
					lastSeating: venue.lastSeating,
					slotMinutes: venue.slotMinutes,
					turnMinutes: venue.turnMinutes,
					minNoticeMinutes: venue.minNoticeMinutes,
					advanceDays: venue.advanceDays,
					maxPartySize: venue.maxPartySize
				}
			: null;

	return {
		id: venue.id,
		title: venue.title,
		reservationsEnabled: venue.reservationsEnabled && venue.isActive,
		cfg,
		tables,
		partyCap: bookablePartyCap(venue.maxPartySize, tables)
	};
}

/** Reservations that still hold a table and overlap [from, to), as table holds. */
export async function loadHolds(
	hotelId: string,
	venueId: string,
	from: Date,
	to: Date,
	executor: Pick<typeof db, 'select'> = db
): Promise<(BusyHold & { reservationId: string })[]> {
	const rows = await executor
		.select({
			reservationId: diningReservations.id,
			startsAt: diningReservations.startsAt,
			endsAt: diningReservations.endsAt,
			tableId: diningReservationTables.tableId
		})
		.from(diningReservations)
		.innerJoin(diningReservationTables, eq(diningReservationTables.reservationId, diningReservations.id))
		.where(
			and(
				eq(diningReservations.hotelId, hotelId),
				eq(diningReservations.diningItemId, venueId),
				inArray(diningReservations.status, [...HOLDING_STATUSES]),
				lt(diningReservations.startsAt, to),
				gt(diningReservations.endsAt, from)
			)
		);

	const byRes = new Map<string, BusyHold & { reservationId: string }>();
	for (const r of rows) {
		const hold = byRes.get(r.reservationId) ?? {
			reservationId: r.reservationId,
			tableIds: [],
			startsAt: r.startsAt,
			endsAt: r.endsAt
		};
		hold.tableIds.push(r.tableId);
		byRes.set(r.reservationId, hold);
	}
	return [...byRes.values()];
}

/** Slots a guest can book on `date` for `partySize`, each flagged available or not. */
export async function getSlotsForDate(args: {
	hotelId: string;
	venueId: string;
	timezone: string;
	date: string;
	partySize: number;
	now?: Date;
}): Promise<SlotAvailability[]> {
	const venue = await loadBookableVenue(args.hotelId, args.venueId);
	if (!venue || !venue.reservationsEnabled || !venue.cfg) return [];
	const now = args.now ?? new Date();
	const slots = listSlots(venue.cfg, args.date, args.timezone, now);
	if (slots.length === 0) return [];
	const holds = await loadHolds(
		args.hotelId,
		args.venueId,
		slots[0]!.startsAt,
		slots[slots.length - 1]!.endsAt
	);
	return availableSlots({
		cfg: venue.cfg,
		tables: venue.tables,
		holds,
		date: args.date,
		tz: args.timezone,
		now,
		partySize: args.partySize
	});
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const makeCode = () =>
	'TB-' + Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

export interface CreateReservationInput {
	hotelId: string;
	venueId: string;
	timezone: string;
	/** `YYYY-MM-DD` and `HH:MM` in the hotel's timezone. */
	date: string;
	time: string;
	partySize: number;
	guestName: string;
	guestPhone?: string | null;
	guestEmail?: string | null;
	remarks?: string | null;
	source: 'online' | 'staff';
	/** Staff may pick the table(s); online bookings are always auto-assigned. */
	tableIds?: string[];
	bookingId?: string | null;
	actor?: Actor;
	now?: Date;
}

/**
 * Books a table. Online bookings must land on an offered slot (seating hours, notice and
 * advance window, party cap) and are auto-assigned the best-fitting free table. Staff
 * bookings may use any time and pick tables, but still can't double-book one. Everything
 * runs under a per-venue advisory lock so two guests can't take the same table at once.
 */
export async function createReservation(
	input: CreateReservationInput
): Promise<{ id: string; code: string; accessToken: string; startsAt: Date; tableNames: string[] }> {
	const venue = await loadBookableVenue(input.hotelId, input.venueId);
	if (!venue) throw new ReservationError('That venue could not be found.');
	if (input.source === 'online' && !venue.reservationsEnabled) {
		throw new ReservationError('This venue is not taking online reservations.');
	}
	if (venue.tables.length === 0) throw new ReservationError('This venue has no tables set up yet.');
	if (!Number.isInteger(input.partySize) || input.partySize < 1) {
		throw new ReservationError('Enter how many people are dining.');
	}

	const turn = venue.cfg?.turnMinutes ?? 90;
	const now = input.now ?? new Date();
	const startsAt = zonedToUtc(input.date, input.time, input.timezone);
	if (Number.isNaN(startsAt.getTime())) throw new ReservationError('Pick a valid date and time.');
	const endsAt = new Date(startsAt.getTime() + turn * 60_000);

	if (input.source === 'online') {
		if (!venue.cfg) throw new ReservationError('This venue is not taking online reservations.');
		if (input.partySize > venue.partyCap) {
			throw new ReservationError(`Online reservations are for up to ${venue.partyCap} guests. Please contact us for larger parties.`);
		}
		const offered = listSlots(venue.cfg, input.date, input.timezone, now);
		if (!offered.some((s) => s.time === input.time)) {
			throw new ReservationError('That time is no longer available. Please pick another.');
		}
	}

	const manualTableIds = input.tableIds?.length ? [...new Set(input.tableIds)] : null;
	if (manualTableIds) {
		const known = new Set(venue.tables.map((t) => t.id));
		if (!manualTableIds.every((id) => known.has(id))) throw new ReservationError('Pick tables from this venue.');
	}

	return db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${input.hotelId}), hashtext(${'dining:' + input.venueId}))`
		);

		const holds = await loadHolds(input.hotelId, input.venueId, startsAt, endsAt, tx);
		const free = freeTables(venue.tables, holds, startsAt, endsAt);

		let assigned: typeof venue.tables;
		if (manualTableIds) {
			assigned = venue.tables.filter((t) => manualTableIds.includes(t.id));
			if (!assigned.every((t) => free.some((f) => f.id === t.id))) {
				throw new ReservationError('One of those tables is already taken at that time.');
			}
		} else {
			const best = bestTable(free, input.partySize);
			if (!best) throw new ReservationError('Sorry, there is no table free at that time. Please pick another.');
			assigned = venue.tables.filter((t) => t.id === best.id);
		}

		let reservationId: string | null = null;
		let code = '';
		let accessToken = '';
		for (let attempt = 0; attempt < 6 && !reservationId; attempt++) {
			code = makeCode();
			const inserted = await tx
				.insert(diningReservations)
				.values({
					hotelId: input.hotelId,
					diningItemId: input.venueId,
					code,
					// Online bookings take the table straight away; `pending` is reserved for
					// reservations waiting on an online pre-order payment (Phase 4).
					status: 'confirmed',
					guestName: input.guestName.trim(),
					guestPhone: input.guestPhone?.trim() || null,
					guestEmail: input.guestEmail?.trim() || null,
					partySize: input.partySize,
					startsAt,
					endsAt,
					remarks: input.remarks?.trim() || null,
					source: input.source,
					bookingId: input.bookingId ?? null,
					createdByUserId: input.actor?.id ?? null
				})
				.onConflictDoNothing({ target: [diningReservations.hotelId, diningReservations.code] })
				.returning({ id: diningReservations.id, accessToken: diningReservations.accessToken });
			if (inserted[0]) {
				reservationId = inserted[0].id;
				accessToken = inserted[0].accessToken;
			}
		}
		if (!reservationId) throw new Error('Could not allocate a reservation code');

		await tx
			.insert(diningReservationTables)
			.values(assigned.map((t) => ({ reservationId: reservationId!, tableId: t.id })));

		await writeAudit({
			hotelId: input.hotelId,
			actor: input.actor ?? null,
			action: 'dining_reservation.create',
			entityType: 'dining_reservation',
			entityId: reservationId,
			after: {
				code,
				venueId: input.venueId,
				partySize: input.partySize,
				startsAt: startsAt.toISOString(),
				tables: assigned.map((t) => t.name),
				source: input.source
			}
		});

		return { id: reservationId, code, accessToken, startsAt, tableNames: assigned.map((t) => t.name) };
	});
}

/** Move a reservation to a new status if the transition is allowed. */
export async function setReservationStatus(args: {
	hotelId: string;
	reservationId: string;
	to: DiningReservationStatus;
	actor?: Actor;
}): Promise<DiningReservation> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(diningReservations)
			.where(and(eq(diningReservations.id, args.reservationId), eq(diningReservations.hotelId, args.hotelId)))
			.for('update');
		if (!row) throw new ReservationError('That reservation could not be found.');
		if (!canTransition(row.status, args.to)) {
			throw new ReservationError(`A ${row.status.replace('_', '-')} reservation can't be marked ${args.to.replace('_', '-')}.`);
		}
		const [updated] = await tx
			.update(diningReservations)
			.set({
				status: args.to,
				cancelledAt: args.to === 'cancelled' ? new Date() : row.cancelledAt,
				updatedAt: new Date()
			})
			.where(eq(diningReservations.id, row.id))
			.returning();
		await writeAudit({
			hotelId: args.hotelId,
			actor: args.actor ?? null,
			action: 'dining_reservation.status',
			entityType: 'dining_reservation',
			entityId: row.id,
			before: { status: row.status },
			after: { status: args.to }
		});
		return updated!;
	});
}

/** Staff move a reservation to other table(s); refuses if any is held at that time. */
export async function reassignReservationTables(args: {
	hotelId: string;
	reservationId: string;
	tableIds: string[];
	actor?: Actor;
}): Promise<void> {
	const tableIds = [...new Set(args.tableIds)];
	if (tableIds.length === 0) throw new ReservationError('Pick at least one table.');

	const [res] = await db
		.select()
		.from(diningReservations)
		.where(and(eq(diningReservations.id, args.reservationId), eq(diningReservations.hotelId, args.hotelId)))
		.limit(1);
	if (!res) throw new ReservationError('That reservation could not be found.');
	if (!(HOLDING_STATUSES as readonly string[]).includes(res.status)) {
		throw new ReservationError("A finished reservation's table can't be changed.");
	}
	const venue = await loadBookableVenue(args.hotelId, res.diningItemId);
	if (!venue || !tableIds.every((id) => venue.tables.some((t) => t.id === id))) {
		throw new ReservationError('Pick tables from this venue.');
	}

	await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${args.hotelId}), hashtext(${'dining:' + res.diningItemId}))`
		);
		const holds = (await loadHolds(args.hotelId, res.diningItemId, res.startsAt, res.endsAt, tx)).filter(
			(h) => h.reservationId !== res.id
		);
		const free = freeTables(venue.tables, holds, res.startsAt, res.endsAt);
		if (!tableIds.every((id) => free.some((f) => f.id === id))) {
			throw new ReservationError('One of those tables is already taken at that time.');
		}
		await tx.delete(diningReservationTables).where(eq(diningReservationTables.reservationId, res.id));
		await tx.insert(diningReservationTables).values(tableIds.map((tableId) => ({ reservationId: res.id, tableId })));
		await writeAudit({
			hotelId: args.hotelId,
			actor: args.actor ?? null,
			action: 'dining_reservation.reassign',
			entityType: 'dining_reservation',
			entityId: res.id,
			after: { tableIds }
		});
	});
}

export interface GuestReservationView {
	id: string;
	code: string;
	status: DiningReservationStatus;
	venueId: string;
	venueTitle: string;
	guestName: string;
	partySize: number;
	startsAt: Date;
	endsAt: Date;
	remarks: string | null;
	tableNames: string[];
	local: { date: string; time: string };
}

/** The guest's own reservation, looked up by code + access token (never by code alone). */
export async function getReservationForGuest(
	hotelId: string,
	timezone: string,
	code: string,
	token: string
): Promise<GuestReservationView | null> {
	if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
	const [row] = await db
		.select({ r: diningReservations, venueTitle: diningItems.title })
		.from(diningReservations)
		.innerJoin(diningItems, eq(diningItems.id, diningReservations.diningItemId))
		.where(
			and(
				eq(diningReservations.hotelId, hotelId),
				eq(diningReservations.code, code.toUpperCase()),
				eq(diningReservations.accessToken, token)
			)
		)
		.limit(1);
	if (!row) return null;
	const tables = await db
		.select({ name: diningTables.name })
		.from(diningReservationTables)
		.innerJoin(diningTables, eq(diningTables.id, diningReservationTables.tableId))
		.where(eq(diningReservationTables.reservationId, row.r.id));
	return {
		id: row.r.id,
		code: row.r.code,
		status: row.r.status,
		venueId: row.r.diningItemId,
		venueTitle: row.venueTitle,
		guestName: row.r.guestName,
		partySize: row.r.partySize,
		startsAt: row.r.startsAt,
		endsAt: row.r.endsAt,
		remarks: row.r.remarks,
		tableNames: tables.map((t) => t.name),
		local: localParts(row.r.startsAt, timezone)
	};
}
