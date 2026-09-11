import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from './db/index';
import {
	bookingRooms,
	bookings,
	functionHalls,
	guestMessages,
	guests,
	hallBookings,
	orders,
	roomTypes,
	users
} from './db/schema/index';
import type { GuestMessageKind, GuestMessageStatus } from './db/schema/index';
import { getOrderIdForTarget, type FolioTarget } from './folio';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';

export class GuestMessageError extends Error {}

const MAX_BODY = 2000;

function cleanBody(body: string, label: string): string {
	const trimmed = body.trim();
	if (!trimmed) throw new GuestMessageError(`Enter ${label}.`);
	if (trimmed.length > MAX_BODY) throw new GuestMessageError(`Keep ${label} under ${MAX_BODY} characters.`);
	return trimmed;
}

/** Resolves a target's current line status, for eligibility checks — mirrors the
 *  status gate `cancelBooking` itself enforces, so a request can't be filed on a
 *  line that's already past the point of being cancellable. */
async function lineStatus(target: FolioTarget): Promise<string | null> {
	if (target.kind === 'room') {
		const [row] = await db
			.select({ status: bookings.status })
			.from(bookings)
			.where(eq(bookings.id, target.bookingId))
			.limit(1);
		return row?.status ?? null;
	}
	const [row] = await db
		.select({ status: hallBookings.status })
		.from(hallBookings)
		.where(eq(hallBookings.id, target.hallBookingId))
		.limit(1);
	return row?.status ?? null;
}

function targetColumns(target: FolioTarget) {
	return target.kind === 'room'
		? { bookingId: target.bookingId, hallBookingId: null }
		: { bookingId: null, hallBookingId: target.hallBookingId };
}

/** The open (unresolved) cancellation request for a specific line, if any — a
 *  guest can only have one in flight per line at a time. */
export async function getOpenRequest(target: FolioTarget) {
	const col = target.kind === 'room' ? guestMessages.bookingId : guestMessages.hallBookingId;
	const id = target.kind === 'room' ? target.bookingId : target.hallBookingId;
	const [row] = await db
		.select()
		.from(guestMessages)
		.where(
			and(
				eq(col, id),
				eq(guestMessages.kind, 'cancellation_request'),
				eq(guestMessages.status, 'open')
			)
		)
		.limit(1);
	return row ?? null;
}

export interface ThreadMessage {
	id: string;
	direction: 'guest' | 'staff';
	kind: GuestMessageKind;
	status: GuestMessageStatus | null;
	body: string;
	lineLabel: string | null;
	staffName: string | null;
	createdAt: Date;
	resolvedAt: Date | null;
}

/** The full guest↔staff thread for an order, oldest first — shown as-is on both
 *  the guest's manage page and the reservation detail page's message panel. */
export async function listThread(orderId: string): Promise<ThreadMessage[]> {
	const rows = await db
		.select({
			id: guestMessages.id,
			direction: guestMessages.direction,
			kind: guestMessages.kind,
			status: guestMessages.status,
			body: guestMessages.body,
			bookingId: guestMessages.bookingId,
			hallBookingId: guestMessages.hallBookingId,
			createdAt: guestMessages.createdAt,
			resolvedAt: guestMessages.resolvedAt,
			staffName: users.name
		})
		.from(guestMessages)
		.leftJoin(users, eq(users.id, guestMessages.createdByUserId))
		.where(eq(guestMessages.orderId, orderId))
		.orderBy(guestMessages.createdAt);

	const bookingIds = [...new Set(rows.map((r) => r.bookingId).filter((v): v is string => Boolean(v)))];
	const hallBookingIds = [
		...new Set(rows.map((r) => r.hallBookingId).filter((v): v is string => Boolean(v)))
	];

	const roomLabels = new Map<string, string>();
	if (bookingIds.length > 0) {
		const roomRows = await db
			.select({ bookingId: bookingRooms.bookingId, name: roomTypes.name })
			.from(bookingRooms)
			.innerJoin(roomTypes, eq(roomTypes.id, bookingRooms.roomTypeId))
			.where(inArray(bookingRooms.bookingId, bookingIds));
		for (const r of roomRows) roomLabels.set(r.bookingId, r.name);
	}
	const hallLabels = new Map<string, string>();
	if (hallBookingIds.length > 0) {
		const hallRows = await db
			.select({ id: hallBookings.id, name: functionHalls.name })
			.from(hallBookings)
			.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
			.where(inArray(hallBookings.id, hallBookingIds));
		for (const h of hallRows) hallLabels.set(h.id, h.name);
	}

	return rows.map((r) => ({
		id: r.id,
		direction: r.direction,
		kind: r.kind,
		status: r.status,
		body: r.body,
		lineLabel: r.bookingId
			? (roomLabels.get(r.bookingId) ?? null)
			: r.hallBookingId
				? (hallLabels.get(r.hallBookingId) ?? null)
				: null,
		staffName: r.staffName,
		createdAt: r.createdAt,
		resolvedAt: r.resolvedAt
	}));
}

/** Guest-side: files a cancellation request for one line. Never cancels anything
 *  or touches money — it only flags the line for staff, who action it through the
 *  existing staff cancel flow (which auto-resolves this request when it succeeds). */
export async function submitCancellationRequest(input: {
	hotelId: string;
	target: FolioTarget;
	reason: string;
}) {
	const reason = cleanBody(input.reason, 'a reason for the cancellation');

	const status = await lineStatus(input.target);
	if (status !== 'confirmed' && status !== 'pending_payment') {
		throw new GuestMessageError(
			status ? `A ${status.replace(/_/g, ' ')} booking can't be cancelled.` : 'Booking not found.'
		);
	}
	if (await getOpenRequest(input.target)) {
		throw new GuestMessageError('You already have an open cancellation request for this booking.');
	}

	const orderId = await getOrderIdForTarget(input.target);
	if (!orderId) throw new GuestMessageError('Booking not found.');

	const [row] = await db
		.insert(guestMessages)
		.values({
			hotelId: input.hotelId,
			orderId,
			...targetColumns(input.target),
			direction: 'guest',
			kind: 'cancellation_request',
			status: 'open',
			body: reason
		})
		.returning({ id: guestMessages.id });

	await writeAudit({
		hotelId: input.hotelId,
		actor: null,
		action: 'guest_message.cancellation_request',
		entityType: input.target.kind === 'room' ? 'booking' : 'hall_booking',
		entityId: input.target.kind === 'room' ? input.target.bookingId : input.target.hallBookingId,
		after: { orderId, reason }
	});

	return row!.id;
}

/** Guest-side: a free-text question, optionally about a specific line. */
export async function submitGuestMessage(input: {
	hotelId: string;
	orderId: string;
	body: string;
	target?: FolioTarget;
}) {
	const body = cleanBody(input.body, 'a message');
	await db.insert(guestMessages).values({
		hotelId: input.hotelId,
		orderId: input.orderId,
		...(input.target ? targetColumns(input.target) : {}),
		direction: 'guest',
		kind: 'message',
		body
	});
}

/** Staff-side: a reply, shown in the same thread the guest sees. */
export async function sendStaffReply(input: {
	hotelId: string;
	orderId: string;
	body: string;
	actor: SessionUser | null;
}) {
	const body = cleanBody(input.body, 'a reply');
	await db.insert(guestMessages).values({
		hotelId: input.hotelId,
		orderId: input.orderId,
		direction: 'staff',
		kind: 'message',
		body,
		createdByUserId: input.actor?.id ?? null
	});
}

/** Staff-side: declines an open cancellation request without cancelling anything
 *  — the required note is posted into the thread as a staff reply so the guest
 *  sees why. */
export async function declineCancellationRequest(input: {
	hotelId: string;
	requestId: string;
	note: string;
	actor: SessionUser | null;
}) {
	const note = cleanBody(input.note, 'a note explaining the decision');

	const [request] = await db
		.select()
		.from(guestMessages)
		.where(eq(guestMessages.id, input.requestId))
		.limit(1);
	if (!request || request.hotelId !== input.hotelId) throw new GuestMessageError('Request not found.');
	if (request.kind !== 'cancellation_request' || request.status !== 'open') {
		throw new GuestMessageError('This request was already resolved.');
	}

	await db
		.update(guestMessages)
		.set({
			status: 'declined',
			resolvedByUserId: input.actor?.id ?? null,
			resolvedAt: new Date()
		})
		.where(eq(guestMessages.id, input.requestId));

	await db.insert(guestMessages).values({
		hotelId: input.hotelId,
		orderId: request.orderId,
		bookingId: request.bookingId,
		hallBookingId: request.hallBookingId,
		direction: 'staff',
		kind: 'message',
		body: note,
		createdByUserId: input.actor?.id ?? null
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'guest_message.decline_cancellation_request',
		entityType: 'guest_message',
		entityId: input.requestId,
		after: { note }
	});

	return request.orderId;
}

/** Marks every unread guest-authored row in an order's thread as seen — called
 *  when staff opens the reservation detail page (or the thread on it). */
export async function markThreadReadByStaff(orderId: string) {
	await db
		.update(guestMessages)
		.set({ readByStaffAt: new Date() })
		.where(
			and(
				eq(guestMessages.orderId, orderId),
				eq(guestMessages.direction, 'guest'),
				isNull(guestMessages.readByStaffAt)
			)
		);
}

/** Count of unread guest-authored rows for a hotel — cheap enough to run on
 *  every staff page load (the sidebar's "Messages" badge), unlike pulling the
 *  full list just to count it. */
export async function countUnreadGuestMessages(hotelId: string): Promise<number> {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(guestMessages)
		.where(
			and(
				eq(guestMessages.hotelId, hotelId),
				eq(guestMessages.direction, 'guest'),
				isNull(guestMessages.readByStaffAt)
			)
		);
	return row?.count ?? 0;
}

export interface GuestMessageListLine {
	id: string;
	createdAt: Date;
	kind: GuestMessageKind;
	status: GuestMessageStatus | null;
	body: string;
	orderId: string;
	orderStatus: string;
	guestName: string;
	isRead: boolean;
	bookingKind: 'room' | 'hall' | null;
	bookingId: string | null;
}

/** Every guest-authored message/request for a hotel, newest first — the
 *  hotel-wide "Messages" list so staff don't have to open every reservation to
 *  notice a new one. */
export async function listGuestMessagesForHotel(hotelId: string, limit = 300): Promise<GuestMessageListLine[]> {
	const rows = await db
		.select({
			id: guestMessages.id,
			createdAt: guestMessages.createdAt,
			kind: guestMessages.kind,
			status: guestMessages.status,
			body: guestMessages.body,
			orderId: guestMessages.orderId,
			orderStatus: orders.status,
			guestName: guests.fullName,
			readByStaffAt: guestMessages.readByStaffAt,
			bookingId: guestMessages.bookingId,
			hallBookingId: guestMessages.hallBookingId
		})
		.from(guestMessages)
		.innerJoin(orders, eq(orders.id, guestMessages.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.where(and(eq(guestMessages.hotelId, hotelId), eq(guestMessages.direction, 'guest')))
		.orderBy(desc(guestMessages.createdAt))
		.limit(limit);

	// A row not already pinned to a line (a general message) still links to the
	// order's own first line, same fallback `email/log.ts` uses.
	const unresolvedOrderIds = [
		...new Set(
			rows
				.filter((r) => !r.bookingId && !r.hallBookingId)
				.map((r) => r.orderId)
		)
	];
	const bookingByOrder = new Map<string, string>();
	const hallByOrder = new Map<string, string>();
	if (unresolvedOrderIds.length > 0) {
		const [bks, hbs] = await Promise.all([
			db
				.select({ id: bookings.id, orderId: bookings.orderId })
				.from(bookings)
				.where(inArray(bookings.orderId, unresolvedOrderIds)),
			db
				.select({ id: hallBookings.id, orderId: hallBookings.orderId })
				.from(hallBookings)
				.where(inArray(hallBookings.orderId, unresolvedOrderIds))
		]);
		for (const b of bks) if (!bookingByOrder.has(b.orderId)) bookingByOrder.set(b.orderId, b.id);
		for (const h of hbs) if (!hallByOrder.has(h.orderId)) hallByOrder.set(h.orderId, h.id);
	}

	return rows.map((r) => {
		const roomId = r.bookingId ?? bookingByOrder.get(r.orderId);
		const hallId = r.hallBookingId ?? hallByOrder.get(r.orderId);
		return {
			id: r.id,
			createdAt: r.createdAt,
			kind: r.kind,
			status: r.status,
			body: r.body,
			orderId: r.orderId,
			orderStatus: r.orderStatus,
			guestName: r.guestName,
			isRead: r.readByStaffAt !== null,
			bookingKind: roomId ? ('room' as const) : hallId ? ('hall' as const) : null,
			bookingId: roomId ?? hallId ?? null
		};
	});
}
