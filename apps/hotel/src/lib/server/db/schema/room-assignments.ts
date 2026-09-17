import { relations } from 'drizzle-orm';
import { date, index, pgTable, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk } from './_shared';
import { bookingRooms } from './bookings';
import { rooms } from './inventory';

/**
 * A specific physical room assigned to a booking's room line — the piece that
 * didn't exist before: `booking_rooms` only ever knew a room *type* (e.g. "2
 * Deluxe Twins"), never which actual room numbers a guest occupies. One row per
 * physical room, so `booking_rooms.quantity > 1` gets several rows here, not one
 * row with a count. `checkIn`/`checkOut` are denormalized from the parent
 * booking at assignment time (booking dates aren't editable today) so overlap
 * checks (`lib/server/front-desk.ts`) are a single-table scan.
 *
 * Usually created at check-in (`checkInBooking`). The front-desk grid's pick
 * mode is the one exception: clicking a specific physical tile pre-assigns that
 * exact room immediately in `createWalkInBooking`, before the booking is even
 * `checked_in` — `checkInBooking` detects and reuses those rows instead of
 * re-inserting. Code reading this table (`getRoomStatusGrid`, `listEligibleRooms`,
 * `searchAvailability`) accounts for both origins; see their own doc comments.
 */
export const roomAssignments = pgTable(
	'room_assignments',
	{
		id: pk(),
		bookingRoomId: uuid('booking_room_id')
			.notNull()
			.references(() => bookingRooms.id, { onDelete: 'cascade' }),
		roomId: uuid('room_id')
			.notNull()
			.references(() => rooms.id, { onDelete: 'restrict' }),
		checkIn: date('check_in', { mode: 'string' }).notNull(),
		checkOut: date('check_out', { mode: 'string' }).notNull(),
		createdAt: createdAt()
	},
	(t) => [
		index('room_assignments_booking_room_idx').on(t.bookingRoomId),
		index('room_assignments_room_idx').on(t.roomId)
	]
);

export const roomAssignmentsRelations = relations(roomAssignments, ({ one }) => ({
	bookingRoom: one(bookingRooms, {
		fields: [roomAssignments.bookingRoomId],
		references: [bookingRooms.id]
	}),
	room: one(rooms, { fields: [roomAssignments.roomId], references: [rooms.id] })
}));

export type RoomAssignment = typeof roomAssignments.$inferSelect;
export type NewRoomAssignment = typeof roomAssignments.$inferInsert;
