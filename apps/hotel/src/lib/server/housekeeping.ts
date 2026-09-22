import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db/index';
import {
	bookingRooms,
	bookings,
	functionHalls,
	hallBookings,
	housekeepingDamageReports,
	housekeepingStatus,
	roomAssignments,
	rooms,
	roomTypes,
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

export interface HousekeepingDetail {
	status: CleanlinessStatus;
	flaggedAt: Date | null;
	clearedAt: Date | null;
	damageReports: HousekeepingDamageReport[];
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
	return {
		status: (status?.status ?? 'clean') as CleanlinessStatus,
		flaggedAt: status?.flaggedAt ?? null,
		clearedAt: status?.clearedAt ?? null,
		damageReports
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
	return {
		status: (status?.status ?? 'clean') as CleanlinessStatus,
		flaggedAt: status?.flaggedAt ?? null,
		clearedAt: status?.clearedAt ?? null,
		damageReports
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
 *  booking if one exists, else its most recently checked-out booking, else null. */
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
