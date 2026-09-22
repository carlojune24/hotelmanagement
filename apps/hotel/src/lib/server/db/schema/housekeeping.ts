import { relations, sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';
import { rooms } from './inventory';
import { functionHalls } from './function-halls';
import { bookings, hallBookings } from './bookings';
import { folioCharges } from './folio';
import { users } from './auth';

export const housekeepingCleanlinessStatus = pgEnum('housekeeping_cleanliness_status', [
	'dirty',
	'in_progress',
	'clean'
]);

export const housekeepingFlagReason = pgEnum('housekeeping_flag_reason', [
	'checkout',
	'manual',
	'completed'
]);

/**
 * One current-state row per room *or* per function hall — never both, enforced by the check
 * constraint below (same `(a is not null) <> (b is not null)` idiom as `folios`/
 * `payment_allocations` in `folio.ts`). Deliberately separate from `rooms.operationalStatus`
 * (`inventory.ts`) — that's an unrelated lifecycle (in/out of service), this is cleanliness.
 * A room/hall with no row here reads as `clean` (nothing has ever flagged it) — see
 * `lib/server/housekeeping.ts`'s board queries, which LEFT JOIN this table.
 */
export const housekeepingStatus = pgTable(
	'housekeeping_status',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'cascade' }),
		functionHallId: uuid('function_hall_id').references(() => functionHalls.id, {
			onDelete: 'cascade'
		}),
		status: housekeepingCleanlinessStatus('status').notNull().default('clean'),
		/** Why it was last flagged dirty — null if it has never been flagged. */
		flagReason: housekeepingFlagReason('flag_reason'),
		/** The booking/hall booking that triggered the last flag, for traceability. Null for a
		 *  manual flag raised with no specific booking in view. */
		triggeringBookingId: uuid('triggering_booking_id').references(() => bookings.id, {
			onDelete: 'set null'
		}),
		triggeringHallBookingId: uuid('triggering_hall_booking_id').references(
			() => hallBookings.id,
			{ onDelete: 'set null' }
		),
		flaggedAt: timestamp('flagged_at', { withTimezone: true }),
		clearedAt: timestamp('cleared_at', { withTimezone: true }),
		clearedByUserId: uuid('cleared_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('housekeeping_status_room_idx').on(t.roomId),
		uniqueIndex('housekeeping_status_hall_idx').on(t.functionHallId),
		index('housekeeping_status_hotel_idx').on(t.hotelId),
		check(
			'housekeeping_status_exactly_one_target',
			sql`(${t.roomId} is not null) <> (${t.functionHallId} is not null)`
		)
	]
);

export const housekeepingDamageReportStatus = pgEnum('housekeeping_damage_report_status', [
	'pending',
	'charged',
	'dismissed'
]);

/**
 * One row per reported damage — many per room/hall over time, unlike `housekeeping_status`'s
 * single current-state row. `bookingId`/`hallBookingId` is resolved and frozen at REPORT time
 * (see `reportRoomDamage`/`reportHallDamage` in `lib/server/housekeeping.ts`), so a report
 * survives the guest checking out before front desk gets to it. Housekeeping never records an
 * amount here — no such column exists — front desk assigns one via the existing
 * `addAdHocCharge` (`folio.ts`) and `resolvedChargeId` links back to the resulting charge.
 */
export const housekeepingDamageReports = pgTable(
	'housekeeping_damage_reports',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'cascade' }),
		functionHallId: uuid('function_hall_id').references(() => functionHalls.id, {
			onDelete: 'cascade'
		}),
		bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
		hallBookingId: uuid('hall_booking_id').references(() => hallBookings.id, {
			onDelete: 'set null'
		}),
		description: text('description').notNull(),
		photoUrl: text('photo_url').notNull(),
		status: housekeepingDamageReportStatus('status').notNull().default('pending'),
		reportedByUserId: uuid('reported_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		resolvedChargeId: uuid('resolved_charge_id').references(() => folioCharges.id, {
			onDelete: 'set null'
		}),
		resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('housekeeping_damage_reports_hotel_idx').on(t.hotelId),
		index('housekeeping_damage_reports_room_idx').on(t.roomId),
		index('housekeeping_damage_reports_hall_idx').on(t.functionHallId),
		index('housekeeping_damage_reports_status_idx').on(t.hotelId, t.status),
		check(
			'housekeeping_damage_reports_exactly_one_target',
			sql`(${t.roomId} is not null) <> (${t.functionHallId} is not null)`
		)
	]
);

export const housekeepingStatusRelations = relations(housekeepingStatus, ({ one }) => ({
	hotel: one(hotels, { fields: [housekeepingStatus.hotelId], references: [hotels.id] }),
	room: one(rooms, { fields: [housekeepingStatus.roomId], references: [rooms.id] }),
	functionHall: one(functionHalls, {
		fields: [housekeepingStatus.functionHallId],
		references: [functionHalls.id]
	})
}));

export const housekeepingDamageReportsRelations = relations(
	housekeepingDamageReports,
	({ one }) => ({
		hotel: one(hotels, { fields: [housekeepingDamageReports.hotelId], references: [hotels.id] }),
		room: one(rooms, { fields: [housekeepingDamageReports.roomId], references: [rooms.id] }),
		functionHall: one(functionHalls, {
			fields: [housekeepingDamageReports.functionHallId],
			references: [functionHalls.id]
		})
	})
);

export type HousekeepingStatus = typeof housekeepingStatus.$inferSelect;
export type HousekeepingDamageReport = typeof housekeepingDamageReports.$inferSelect;
