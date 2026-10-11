import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db/index';
import {
	bookingRooms,
	bookings,
	functionHalls,
	guests,
	hallBookings,
	housekeepingDamageReports,
	housekeepingInspections,
	housekeepingStatus,
	orders,
	roomAssignments,
	rooms,
	roomTypes,
	users,
	type HousekeepingDamageReport
} from './db/schema/index';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';

export class HousekeepingError extends Error {}

export type CleanlinessStatus = 'dirty' | 'in_progress' | 'clean';

// ---------------------------------------------------------------------------
// Read models — the Housekeeping page's own boards
// ---------------------------------------------------------------------------

export interface HousekeepingRoomCell {
	roomId: string;
	roomNumber: string;
	floor: string | null;
	roomTypeId: string;
	roomTypeName: string;
	roomTypeColor: string | null;
	status: CleanlinessStatus;
	/** `rooms.operationalStatus !== 'available'` — tile renders muted regardless of `status`. */
	isOutOfOrder: boolean;
	pendingDamageReportCount: number;
}

/** Housekeeping's own room board: every active room, colored by cleanliness instead of
 *  occupancy. A room with no `housekeeping_status` row has never been flagged and reads
 *  as `clean`. Grouped by floor client-side, same convention as `getRoomStatusGrid`. */
export async function getHousekeepingRoomBoard(hotelId: string): Promise<HousekeepingRoomCell[]> {
	const roomRows = await db
		.select({
			roomId: rooms.id,
			roomNumber: rooms.roomNumber,
			floor: rooms.floor,
			operationalStatus: rooms.operationalStatus,
			roomTypeId: rooms.roomTypeId,
			roomTypeName: roomTypes.name,
			roomTypeColor: roomTypes.colorHex,
			hkStatus: housekeepingStatus.status
		})
		.from(rooms)
		.innerJoin(roomTypes, eq(roomTypes.id, rooms.roomTypeId))
		.leftJoin(housekeepingStatus, eq(housekeepingStatus.roomId, rooms.id))
		.where(and(eq(rooms.hotelId, hotelId), eq(rooms.isActive, true)))
		.orderBy(rooms.floor, rooms.sortOrder, rooms.roomNumber);

	if (roomRows.length === 0) return [];

	const pendingCounts = await db
		.select({ roomId: housekeepingDamageReports.roomId, count: sql<number>`count(*)::int` })
		.from(housekeepingDamageReports)
		.where(
			and(
				eq(housekeepingDamageReports.hotelId, hotelId),
				eq(housekeepingDamageReports.status, 'pending')
			)
		)
		.groupBy(housekeepingDamageReports.roomId);
	const pendingByRoom = new Map(pendingCounts.map((r) => [r.roomId, r.count]));

	return roomRows.map((r) => ({
		roomId: r.roomId,
		roomNumber: r.roomNumber,
		floor: r.floor,
		roomTypeId: r.roomTypeId,
		roomTypeName: r.roomTypeName,
		roomTypeColor: r.roomTypeColor,
		status: (r.hkStatus ?? 'clean') as CleanlinessStatus,
		isOutOfOrder: r.operationalStatus !== 'available',
		pendingDamageReportCount: pendingByRoom.get(r.roomId) ?? 0
	}));
}

export interface HousekeepingHallCell {
	functionHallId: string;
	hallName: string;
	status: CleanlinessStatus;
	pendingDamageReportCount: number;
}

export async function getHousekeepingHallBoard(hotelId: string): Promise<HousekeepingHallCell[]> {
	const hallRows = await db
		.select({
			functionHallId: functionHalls.id,
			hallName: functionHalls.name,
			hkStatus: housekeepingStatus.status
		})
		.from(functionHalls)
		.leftJoin(housekeepingStatus, eq(housekeepingStatus.functionHallId, functionHalls.id))
		.where(and(eq(functionHalls.hotelId, hotelId), eq(functionHalls.isActive, true)))
		.orderBy(functionHalls.sortOrder, functionHalls.name);

	if (hallRows.length === 0) return [];

	const pendingCounts = await db
		.select({
			functionHallId: housekeepingDamageReports.functionHallId,
			count: sql<number>`count(*)::int`
		})
		.from(housekeepingDamageReports)
		.where(
			and(
				eq(housekeepingDamageReports.hotelId, hotelId),
				eq(housekeepingDamageReports.status, 'pending')
			)
		)
		.groupBy(housekeepingDamageReports.functionHallId);
	const pendingByHall = new Map(pendingCounts.map((r) => [r.functionHallId, r.count]));

	return hallRows.map((r) => ({
		functionHallId: r.functionHallId,
		hallName: r.hallName,
		status: (r.hkStatus ?? 'clean') as CleanlinessStatus,
		pendingDamageReportCount: pendingByHall.get(r.functionHallId) ?? 0
	}));
}

/** Who a booking/hall booking was for — the "data integrity" reference the housekeeping
 *  panel was missing: a booking code (same `orders.id.slice(0,8).toUpperCase()` convention
 *  used everywhere else in the app, e.g. `reservations.ts`) plus the guest's name. */
export interface HousekeepingBookingRef {
	bookingCode: string;
	guestName: string;
}

/** Batch-resolves room-booking ids to their order's booking code + guest name. Missing ids
 *  (booking deleted, or none given) are simply absent from the returned map. */
async function loadBookingRefs(bookingIds: string[]): Promise<Map<string, HousekeepingBookingRef>> {
	const map = new Map<string, HousekeepingBookingRef>();
	const ids = [...new Set(bookingIds)];
	if (ids.length === 0) return map;
	const rows = await db
		.select({
			bookingId: bookings.id,
			orderId: orders.id,
			guestName: guests.fullName
		})
		.from(bookings)
		.innerJoin(orders, eq(orders.id, bookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.where(inArray(bookings.id, ids));
	for (const r of rows) {
		map.set(r.bookingId, { bookingCode: r.orderId.slice(0, 8).toUpperCase(), guestName: r.guestName });
	}
	return map;
}

/** Same as `loadBookingRefs` but for function-hall reservations. */
async function loadHallBookingRefs(
	hallBookingIds: string[]
): Promise<Map<string, HousekeepingBookingRef>> {
	const map = new Map<string, HousekeepingBookingRef>();
	const ids = [...new Set(hallBookingIds)];
	if (ids.length === 0) return map;
	const rows = await db
		.select({
			hallBookingId: hallBookings.id,
			orderId: orders.id,
			guestName: guests.fullName
		})
		.from(hallBookings)
		.innerJoin(orders, eq(orders.id, hallBookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.where(inArray(hallBookings.id, ids));
	for (const r of rows) {
		map.set(r.hallBookingId, {
			bookingCode: r.orderId.slice(0, 8).toUpperCase(),
			guestName: r.guestName
		});
	}
	return map;
}

/** A damage report enriched with which booking/guest it was filed against — `bookingId`
 *  is frozen at report time (see `reportRoomDamage`/`reportHallDamage`), so this stays
 *  accurate even once the guest has checked out or a new guest has since checked in. */
export interface HousekeepingDamageReportView extends HousekeepingDamageReport {
	bookingRef: HousekeepingBookingRef | null;
}

export interface HousekeepingDetail {
	status: CleanlinessStatus;
	flaggedAt: Date | null;
	clearedAt: Date | null;
	/** Why/who the *current* status came from — null once nothing has ever flagged it, or
	 *  after it's been cleared with no new flag since. A manual flag with no booking in
	 *  view (`flagReason === 'manual'` and no triggering booking) leaves `bookingRef` null. */
	flagReason: 'checkout' | 'manual' | 'completed' | null;
	flaggedBookingRef: HousekeepingBookingRef | null;
	/** Not yet resolved — the ones that actually need front-desk/staff attention now. */
	openDamageReports: HousekeepingDamageReportView[];
	/** Already charged or dismissed — kept for the record, not for action; the UI keeps
	 *  these collapsed by default so a freshly-cleaned room doesn't look like it still has
	 *  open issues. */
	resolvedDamageReports: HousekeepingDamageReportView[];
	/** The latest "no damages" sign-off for a room that no damage report has superseded; always
	 *  null for a function hall (inspection sign-off is a room stay thing). */
	inspection: { inspectedAt: Date; inspectedByName: string | null; note: string | null } | null;
}

export async function getHousekeepingRoomDetail(
	hotelId: string,
	roomId: string
): Promise<HousekeepingDetail> {
	const [status] = await db
		.select()
		.from(housekeepingStatus)
		.where(and(eq(housekeepingStatus.hotelId, hotelId), eq(housekeepingStatus.roomId, roomId)))
		.limit(1);
	const damageReports = await db
		.select()
		.from(housekeepingDamageReports)
		.where(
			and(eq(housekeepingDamageReports.hotelId, hotelId), eq(housekeepingDamageReports.roomId, roomId))
		)
		.orderBy(desc(housekeepingDamageReports.createdAt));

	const bookingIds = damageReports.map((r) => r.bookingId).filter((id): id is string => !!id);
	if (status?.triggeringBookingId) bookingIds.push(status.triggeringBookingId);
	const refs = await loadBookingRefs(bookingIds);

	const view = (r: HousekeepingDamageReport): HousekeepingDamageReportView => ({
		...r,
		bookingRef: r.bookingId ? (refs.get(r.bookingId) ?? null) : null
	});

	return {
		status: (status?.status ?? 'clean') as CleanlinessStatus,
		flaggedAt: status?.flaggedAt ?? null,
		clearedAt: status?.clearedAt ?? null,
		flagReason: status?.flagReason ?? null,
		flaggedBookingRef: status?.triggeringBookingId
			? (refs.get(status.triggeringBookingId) ?? null)
			: null,
		openDamageReports: damageReports.filter((r) => r.status === 'pending').map(view),
		resolvedDamageReports: damageReports.filter((r) => r.status !== 'pending').map(view),
		inspection: await getLatestRoomInspections(hotelId, [roomId]).then((m) => {
			const i = m.get(roomId);
			return i ? { inspectedAt: i.inspectedAt, inspectedByName: i.inspectedByName, note: i.note } : null;
		})
	};
}

export async function getHousekeepingHallDetail(
	hotelId: string,
	functionHallId: string
): Promise<HousekeepingDetail> {
	const [status] = await db
		.select()
		.from(housekeepingStatus)
		.where(
			and(
				eq(housekeepingStatus.hotelId, hotelId),
				eq(housekeepingStatus.functionHallId, functionHallId)
			)
		)
		.limit(1);
	const damageReports = await db
		.select()
		.from(housekeepingDamageReports)
		.where(
			and(
				eq(housekeepingDamageReports.hotelId, hotelId),
				eq(housekeepingDamageReports.functionHallId, functionHallId)
			)
		)
		.orderBy(desc(housekeepingDamageReports.createdAt));

	const hallBookingIds = damageReports
		.map((r) => r.hallBookingId)
		.filter((id): id is string => !!id);
	if (status?.triggeringHallBookingId) hallBookingIds.push(status.triggeringHallBookingId);
	const refs = await loadHallBookingRefs(hallBookingIds);

	const view = (r: HousekeepingDamageReport): HousekeepingDamageReportView => ({
		...r,
		bookingRef: r.hallBookingId ? (refs.get(r.hallBookingId) ?? null) : null
	});

	return {
		status: (status?.status ?? 'clean') as CleanlinessStatus,
		flaggedAt: status?.flaggedAt ?? null,
		clearedAt: status?.clearedAt ?? null,
		flagReason: status?.flagReason ?? null,
		flaggedBookingRef: status?.triggeringHallBookingId
			? (refs.get(status.triggeringHallBookingId) ?? null)
			: null,
		openDamageReports: damageReports.filter((r) => r.status === 'pending').map(view),
		resolvedDamageReports: damageReports.filter((r) => r.status !== 'pending').map(view),
		inspection: null
	};
}

// ---------------------------------------------------------------------------
// Front-desk-facing overlay — merged into Front Desk's own room grid.
// Deliberately does not import `front-desk.ts`.
// ---------------------------------------------------------------------------

export interface PendingDamageReport {
	id: string;
	bookingId: string | null;
	description: string;
	photoUrl: string;
	reportedAt: Date;
}

export interface RoomHousekeepingOverlay {
	status: CleanlinessStatus;
	pendingDamageReports: PendingDamageReport[];
}

/** Cleanliness status + pending damage reports for a batch of rooms, for Front Desk's grid
 *  and Sheet. A room with no row/reports is simply absent from the returned map. */
export async function getRoomHousekeepingOverlay(
	hotelId: string,
	roomIds: string[]
): Promise<Map<string, RoomHousekeepingOverlay>> {
	const overlay = new Map<string, RoomHousekeepingOverlay>();
	if (roomIds.length === 0) return overlay;

	const statusRows = await db
		.select({ roomId: housekeepingStatus.roomId, status: housekeepingStatus.status })
		.from(housekeepingStatus)
		.where(and(eq(housekeepingStatus.hotelId, hotelId), inArray(housekeepingStatus.roomId, roomIds)));
	for (const r of statusRows) {
		if (!r.roomId) continue;
		overlay.set(r.roomId, { status: r.status as CleanlinessStatus, pendingDamageReports: [] });
	}

	const pendingRows = await db
		.select({
			id: housekeepingDamageReports.id,
			roomId: housekeepingDamageReports.roomId,
			bookingId: housekeepingDamageReports.bookingId,
			description: housekeepingDamageReports.description,
			photoUrl: housekeepingDamageReports.photoUrl,
			reportedAt: housekeepingDamageReports.createdAt
		})
		.from(housekeepingDamageReports)
		.where(
			and(
				eq(housekeepingDamageReports.hotelId, hotelId),
				inArray(housekeepingDamageReports.roomId, roomIds),
				eq(housekeepingDamageReports.status, 'pending')
			)
		)
		.orderBy(desc(housekeepingDamageReports.createdAt));
	for (const r of pendingRows) {
		if (!r.roomId) continue;
		const entry = overlay.get(r.roomId) ?? { status: 'clean' as CleanlinessStatus, pendingDamageReports: [] };
		entry.pendingDamageReports.push({
			id: r.id,
			bookingId: r.bookingId,
			description: r.description,
			photoUrl: r.photoUrl,
			reportedAt: r.reportedAt
		});
		overlay.set(r.roomId, entry);
	}

	return overlay;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

async function upsertHousekeepingStatus(
	hotelId: string,
	target: { roomId: string } | { functionHallId: string },
	values: Partial<{
		status: CleanlinessStatus;
		flagReason: 'checkout' | 'manual' | 'completed' | null;
		triggeringBookingId: string | null;
		triggeringHallBookingId: string | null;
		flaggedAt: Date | null;
		clearedAt: Date | null;
		clearedByUserId: string | null;
	}>
) {
	const whereTarget =
		'roomId' in target
			? eq(housekeepingStatus.roomId, target.roomId)
			: eq(housekeepingStatus.functionHallId, target.functionHallId);

	const [existing] = await db
		.select({ id: housekeepingStatus.id })
		.from(housekeepingStatus)
		.where(and(eq(housekeepingStatus.hotelId, hotelId), whereTarget))
		.limit(1);

	if (existing) {
		await db
			.update(housekeepingStatus)
			.set({ ...values, updatedAt: new Date() })
			.where(eq(housekeepingStatus.id, existing.id));
	} else {
		await db.insert(housekeepingStatus).values({
			hotelId,
			roomId: 'roomId' in target ? target.roomId : null,
			functionHallId: 'functionHallId' in target ? target.functionHallId : null,
			status: values.status ?? 'clean',
			flagReason: values.flagReason ?? null,
			triggeringBookingId: values.triggeringBookingId ?? null,
			triggeringHallBookingId: values.triggeringHallBookingId ?? null,
			flaggedAt: values.flaggedAt ?? null,
			clearedAt: values.clearedAt ?? null,
			clearedByUserId: values.clearedByUserId ?? null
		});
	}
}

/** Manual or automatic flag — always wins over whatever state the room was in. */
export async function flagRoomForHousekeeping(
	hotelId: string,
	roomId: string,
	reason: 'checkout' | 'manual',
	triggeringBookingId: string | null,
	actor: SessionUser | null
): Promise<void> {
	await upsertHousekeepingStatus(
		hotelId,
		{ roomId },
		{
			status: 'dirty',
			flagReason: reason,
			triggeringBookingId,
			flaggedAt: new Date(),
			clearedAt: null,
			clearedByUserId: null
		}
	);
	await writeAudit({
		hotelId,
		actor,
		action: 'housekeeping.flag_room',
		entityType: 'room',
		entityId: roomId,
		after: { reason, triggeringBookingId }
	});
}

export async function flagHallForHousekeeping(
	hotelId: string,
	functionHallId: string,
	reason: 'completed' | 'manual',
	triggeringHallBookingId: string | null,
	actor: SessionUser | null
): Promise<void> {
	await upsertHousekeepingStatus(
		hotelId,
		{ functionHallId },
		{
			status: 'dirty',
			flagReason: reason,
			triggeringHallBookingId,
			flaggedAt: new Date(),
			clearedAt: null,
			clearedByUserId: null
		}
	);
	await writeAudit({
		hotelId,
		actor,
		action: 'housekeeping.flag_hall',
		entityType: 'function_hall',
		entityId: functionHallId,
		after: { reason, triggeringHallBookingId }
	});
}

async function requireStatusRow(hotelId: string, target: { roomId: string } | { functionHallId: string }) {
	const whereTarget =
		'roomId' in target
			? eq(housekeepingStatus.roomId, target.roomId)
			: eq(housekeepingStatus.functionHallId, target.functionHallId);
	const [row] = await db
		.select()
		.from(housekeepingStatus)
		.where(and(eq(housekeepingStatus.hotelId, hotelId), whereTarget))
		.limit(1);
	if (!row) throw new HousekeepingError('This has never been flagged for housekeeping.');
	return row;
}

export async function startCleaningRoom(
	hotelId: string,
	roomId: string,
	actor: SessionUser | null
): Promise<void> {
	const row = await requireStatusRow(hotelId, { roomId });
	if (row.status !== 'dirty') {
		throw new HousekeepingError('Only a room marked dirty can be started.');
	}
	await db
		.update(housekeepingStatus)
		.set({ status: 'in_progress', updatedAt: new Date() })
		.where(eq(housekeepingStatus.id, row.id));
	await writeAudit({ hotelId, actor, action: 'housekeeping.start_cleaning', entityType: 'room', entityId: roomId });
}

export async function startCleaningHall(
	hotelId: string,
	functionHallId: string,
	actor: SessionUser | null
): Promise<void> {
	const row = await requireStatusRow(hotelId, { functionHallId });
	if (row.status !== 'dirty') {
		throw new HousekeepingError('Only a hall marked dirty can be started.');
	}
	await db
		.update(housekeepingStatus)
		.set({ status: 'in_progress', updatedAt: new Date() })
		.where(eq(housekeepingStatus.id, row.id));
	await writeAudit({
		hotelId,
		actor,
		action: 'housekeeping.start_cleaning',
		entityType: 'function_hall',
		entityId: functionHallId
	});
}

export async function markRoomClean(
	hotelId: string,
	roomId: string,
	actor: SessionUser | null
): Promise<void> {
	await upsertHousekeepingStatus(
		hotelId,
		{ roomId },
		{ status: 'clean', clearedAt: new Date(), clearedByUserId: actor?.id ?? null }
	);
	await writeAudit({ hotelId, actor, action: 'housekeeping.mark_clean', entityType: 'room', entityId: roomId });
}

export async function markHallClean(
	hotelId: string,
	functionHallId: string,
	actor: SessionUser | null
): Promise<void> {
	await upsertHousekeepingStatus(
		hotelId,
		{ functionHallId },
		{ status: 'clean', clearedAt: new Date(), clearedByUserId: actor?.id ?? null }
	);
	await writeAudit({
		hotelId,
		actor,
		action: 'housekeeping.mark_clean',
		entityType: 'function_hall',
		entityId: functionHallId
	});
}

/** Finds the booking to attribute a new damage report to: the room's currently checked-in
 *  booking if one exists, else its most recently checked-out booking, else null. With more
 *  than one checked-in stay on the room (an overdue stay nobody checked out, plus the new
 *  guest), the latest-starting stay wins — the guest actually in the room now. */
export async function resolveBookingForRoomDamage(
	hotelId: string,
	roomId: string
): Promise<string | null> {
	const [current] = await db
		.select({ bookingId: bookings.id })
		.from(roomAssignments)
		.innerJoin(bookingRooms, eq(bookingRooms.id, roomAssignments.bookingRoomId))
		.innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
		.where(
			and(eq(roomAssignments.roomId, roomId), eq(bookings.hotelId, hotelId), eq(bookings.status, 'checked_in'))
		)
		.orderBy(desc(roomAssignments.checkIn), desc(bookings.createdAt))
		.limit(1);
	if (current) return current.bookingId;

	const [recent] = await db
		.select({ bookingId: bookings.id })
		.from(roomAssignments)
		.innerJoin(bookingRooms, eq(bookingRooms.id, roomAssignments.bookingRoomId))
		.innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
		.where(
			and(eq(roomAssignments.roomId, roomId), eq(bookings.hotelId, hotelId), eq(bookings.status, 'checked_out'))
		)
		.orderBy(desc(bookings.updatedAt))
		.limit(1);
	return recent?.bookingId ?? null;
}

/** Housekeeping reports damage — description + an already-uploaded photo URL. No amount
 *  parameter exists here at all: housekeeping never sets a peso amount, front desk does
 *  (see `resolveHousekeepingDamage` in `front-desk/+page.server.ts`). */
export async function reportRoomDamage(
	hotelId: string,
	roomId: string,
	input: { description: string; photoUrl: string },
	actor: SessionUser | null
): Promise<{ damageReportId: string }> {
	if (!input.description.trim()) throw new HousekeepingError('Describe the damage.');
	const bookingId = await resolveBookingForRoomDamage(hotelId, roomId);
	const [row] = await db
		.insert(housekeepingDamageReports)
		.values({
			hotelId,
			roomId,
			bookingId,
			description: input.description.trim(),
			photoUrl: input.photoUrl,
			reportedByUserId: actor?.id ?? null
		})
		.returning({ id: housekeepingDamageReports.id });
	if (!row) throw new HousekeepingError('Could not save the damage report.');
	await writeAudit({
		hotelId,
		actor,
		action: 'housekeeping.report_damage',
		entityType: 'room',
		entityId: roomId,
		after: { damageReportId: row.id, bookingId }
	});
	return { damageReportId: row.id };
}

export async function reportHallDamage(
	hotelId: string,
	functionHallId: string,
	input: { description: string; photoUrl: string },
	actor: SessionUser | null
): Promise<{ damageReportId: string }> {
	if (!input.description.trim()) throw new HousekeepingError('Describe the damage.');
	const [hallBooking] = await db
		.select({ id: hallBookings.id })
		.from(hallBookings)
		.where(and(eq(hallBookings.functionHallId, functionHallId), eq(hallBookings.status, 'completed')))
		.orderBy(desc(hallBookings.createdAt))
		.limit(1);
	const [row] = await db
		.insert(housekeepingDamageReports)
		.values({
			hotelId,
			functionHallId,
			hallBookingId: hallBooking?.id ?? null,
			description: input.description.trim(),
			photoUrl: input.photoUrl,
			reportedByUserId: actor?.id ?? null
		})
		.returning({ id: housekeepingDamageReports.id });
	if (!row) throw new HousekeepingError('Could not save the damage report.');
	await writeAudit({
		hotelId,
		actor,
		action: 'housekeeping.report_damage',
		entityType: 'function_hall',
		entityId: functionHallId,
		after: { damageReportId: row.id, hallBookingId: hallBooking?.id ?? null }
	});
	return { damageReportId: row.id };
}

export async function dismissDamageReport(
	hotelId: string,
	damageReportId: string,
	actor: SessionUser | null
): Promise<void> {
	const [row] = await db
		.select({ id: housekeepingDamageReports.id, status: housekeepingDamageReports.status })
		.from(housekeepingDamageReports)
		.where(and(eq(housekeepingDamageReports.hotelId, hotelId), eq(housekeepingDamageReports.id, damageReportId)))
		.limit(1);
	if (!row) throw new HousekeepingError('Damage report not found.');
	if (row.status !== 'pending') throw new HousekeepingError('Only a pending report can be dismissed.');
	await db
		.update(housekeepingDamageReports)
		.set({ status: 'dismissed', resolvedByUserId: actor?.id ?? null, resolvedAt: new Date(), updatedAt: new Date() })
		.where(eq(housekeepingDamageReports.id, damageReportId));
	await writeAudit({
		hotelId,
		actor,
		action: 'housekeeping.dismiss_damage',
		entityType: 'housekeeping_damage_report',
		entityId: damageReportId
	});
}

/** The full row for a damage report — used by Front Desk's `resolveHousekeepingDamage`
 *  action to re-derive the charge description server-side rather than trusting a client
 *  field, and to verify the report is still `pending` before charging it. */
export async function getDamageReportById(
	hotelId: string,
	damageReportId: string
): Promise<HousekeepingDamageReport | null> {
	const [row] = await db
		.select()
		.from(housekeepingDamageReports)
		.where(and(eq(housekeepingDamageReports.hotelId, hotelId), eq(housekeepingDamageReports.id, damageReportId)))
		.limit(1);
	return row ?? null;
}

/** Marks a pending report resolved by charge — called by `resolveHousekeepingDamage` in
 *  `front-desk/+page.server.ts` right after it posts the folio charge for the amount front
 *  desk entered. `chargeId` links the report to the actual `folio_charges` row. */
export async function markDamageReportCharged(
	hotelId: string,
	damageReportId: string,
	chargeId: string,
	actor: SessionUser | null
): Promise<void> {
	const [row] = await db
		.select({ id: housekeepingDamageReports.id, status: housekeepingDamageReports.status })
		.from(housekeepingDamageReports)
		.where(and(eq(housekeepingDamageReports.hotelId, hotelId), eq(housekeepingDamageReports.id, damageReportId)))
		.limit(1);
	if (!row) throw new HousekeepingError('Damage report not found.');
	if (row.status !== 'pending') throw new HousekeepingError('This report was already resolved.');
	await db
		.update(housekeepingDamageReports)
		.set({
			status: 'charged',
			resolvedChargeId: chargeId,
			resolvedByUserId: actor?.id ?? null,
			resolvedAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(housekeepingDamageReports.id, damageReportId));
	await writeAudit({
		hotelId,
		actor,
		action: 'housekeeping.charge_damage',
		entityType: 'housekeeping_damage_report',
		entityId: damageReportId,
		after: { chargeId }
	});
}

/** Damage reports Housekeeping filed that front desk hasn't charged or dismissed yet —
 *  rooms and function halls alike. Drives the dashboard's "needs attention" row. */
export async function countPendingDamageReports(hotelId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(housekeepingDamageReports)
		.where(
			and(
				eq(housekeepingDamageReports.hotelId, hotelId),
				eq(housekeepingDamageReports.status, 'pending')
			)
		);
	return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// "No damages" — a housekeeper's inspection sign-off
// ---------------------------------------------------------------------------

/** A recorded sign-off that a room was inspected after a stay and nothing was damaged. */
export interface RoomInspectionView {
	roomId: string;
	/** The stay it was signed off for, resolved when the housekeeper tapped the button. */
	bookingId: string | null;
	inspectedAt: Date;
	inspectedByName: string | null;
	note: string | null;
}

/**
 * Housekeeping signs off that a room was inspected and nothing is damaged. This only records the
 * fact (and audits it): it does not change cleanliness, charge anything or release a deposit. Front
 * desk sees it beside the deposit; the deposit and checkout rules do not depend on it.
 *
 * It is refused while a damage report on the room is still waiting for front desk — "no damages"
 * and an open report cannot both be true. Tapping it again for the same stay changes nothing.
 */
export async function markRoomNoDamage(
	hotelId: string,
	roomId: string,
	input: { note?: string | null },
	actor: SessionUser | null
): Promise<{ alreadyRecorded: boolean }> {
	const [room] = await db
		.select({ id: rooms.id })
		.from(rooms)
		.where(and(eq(rooms.id, roomId), eq(rooms.hotelId, hotelId)))
		.limit(1);
	if (!room) throw new HousekeepingError('Room not found.');

	const [pending] = await db
		.select({ id: housekeepingDamageReports.id })
		.from(housekeepingDamageReports)
		.where(
			and(
				eq(housekeepingDamageReports.hotelId, hotelId),
				eq(housekeepingDamageReports.roomId, roomId),
				eq(housekeepingDamageReports.status, 'pending')
			)
		)
		.limit(1);
	if (pending) {
		throw new HousekeepingError(
			'A damage report on this room is still waiting for front desk. It has to be charged or dismissed first.'
		);
	}

	const bookingId = await resolveBookingForRoomDamage(hotelId, roomId);
	const [existing] = await db
		.select({ id: housekeepingInspections.id })
		.from(housekeepingInspections)
		.where(
			and(
				eq(housekeepingInspections.hotelId, hotelId),
				eq(housekeepingInspections.roomId, roomId),
				bookingId
					? eq(housekeepingInspections.bookingId, bookingId)
					: sql`${housekeepingInspections.bookingId} is null`
			)
		)
		.orderBy(desc(housekeepingInspections.inspectedAt))
		.limit(1);
	if (existing) {
		// A damage report filed since then makes that older sign-off stale; a fresh tap supersedes it.
		const [laterDamage] = await db
			.select({ id: housekeepingDamageReports.id })
			.from(housekeepingDamageReports)
			.innerJoin(housekeepingInspections, eq(housekeepingInspections.id, existing.id))
			.where(
				and(
					eq(housekeepingDamageReports.hotelId, hotelId),
					eq(housekeepingDamageReports.roomId, roomId),
					sql`${housekeepingDamageReports.createdAt} > ${housekeepingInspections.inspectedAt}`
				)
			)
			.limit(1);
		if (!laterDamage) return { alreadyRecorded: true };
	}

	const note = input.note?.trim().slice(0, 300) || null;
	const [row] = await db
		.insert(housekeepingInspections)
		.values({
			hotelId,
			roomId,
			bookingId,
			result: 'no_damage',
			note,
			inspectedByUserId: actor?.id ?? null
		})
		.returning({ id: housekeepingInspections.id });
	await writeAudit({
		hotelId,
		actor,
		action: 'housekeeping.no_damage',
		entityType: 'room',
		entityId: roomId,
		after: { inspectionId: row!.id, bookingId, note }
	});
	return { alreadyRecorded: false };
}

/**
 * The latest "no damages" sign-off per room, for a batch of rooms — what Front Desk shows beside a
 * deposit. A sign-off that a damage report has since been filed against is left out: it no longer
 * says the room is undamaged. Rooms never inspected are simply absent.
 */
export async function getLatestRoomInspections(
	hotelId: string,
	roomIds: string[]
): Promise<Map<string, RoomInspectionView>> {
	const out = new Map<string, RoomInspectionView>();
	if (roomIds.length === 0) return out;

	const rows = await db
		.select({
			roomId: housekeepingInspections.roomId,
			bookingId: housekeepingInspections.bookingId,
			inspectedAt: housekeepingInspections.inspectedAt,
			note: housekeepingInspections.note,
			by: users.name
		})
		.from(housekeepingInspections)
		.leftJoin(users, eq(users.id, housekeepingInspections.inspectedByUserId))
		.where(and(eq(housekeepingInspections.hotelId, hotelId), inArray(housekeepingInspections.roomId, roomIds)))
		.orderBy(desc(housekeepingInspections.inspectedAt));
	for (const r of rows) {
		if (out.has(r.roomId)) continue;
		out.set(r.roomId, {
			roomId: r.roomId,
			bookingId: r.bookingId,
			inspectedAt: r.inspectedAt,
			inspectedByName: r.by ?? null,
			note: r.note
		});
	}

	// A report filed after the sign-off supersedes it.
	const damaged = await db
		.select({ roomId: housekeepingDamageReports.roomId, at: sql<Date>`max(${housekeepingDamageReports.createdAt})` })
		.from(housekeepingDamageReports)
		.where(and(eq(housekeepingDamageReports.hotelId, hotelId), inArray(housekeepingDamageReports.roomId, roomIds)))
		.groupBy(housekeepingDamageReports.roomId);
	for (const d of damaged) {
		const insp = d.roomId ? out.get(d.roomId) : undefined;
		if (insp && new Date(d.at) > insp.inspectedAt) out.delete(d.roomId!);
	}
	return out;
}

