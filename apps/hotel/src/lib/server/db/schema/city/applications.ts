import { relations } from 'drizzle-orm';
import { date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from '../_shared';
import { hotels } from '../hotels';
import { users } from '../auth';

export const cityApplicationStatus = pgEnum('city_application_status', [
	'pending',
	'approved',
	'rejected',
	'finalized'
]);

/**
 * A hotel's application to be registered with the city, entered by city staff. `finalized` means the
 * city created the hotel from it (`hotelId` then points at the new tenant). Lives only in the city DB;
 * never re-exported from `schema/index.ts` so main's schema and migrations stay untouched.
 */
export const cityApplications = pgTable(
	'city_applications',
	{
		id: pk(),
		/** Human-readable reference quoted to the applicant, e.g. APP-7K3M9Q2X. */
		ref: text('ref').notNull(),
		hotelName: text('hotel_name').notNull(),
		addressLine: text('address_line'),
		city: text('city'),
		contactName: text('contact_name').notNull(),
		contactEmail: text('contact_email').notNull(),
		contactPhone: text('contact_phone'),
		permitNumber: text('permit_number'),
		permitExpiresOn: date('permit_expires_on', { mode: 'string' }),
		declaredRooms: integer('declared_rooms'),
		notes: text('notes'),
		status: cityApplicationStatus('status').notNull().default('pending'),
		decisionNote: text('decision_note'),
		decidedAt: timestamp('decided_at', { withTimezone: true }),
		decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
		enteredBy: uuid('entered_by').references(() => users.id, { onDelete: 'set null' }),
		hotelId: uuid('hotel_id').references(() => hotels.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('city_applications_ref_idx').on(t.ref),
		index('city_applications_status_idx').on(t.status, t.createdAt)
	]
);

export const cityApplicationsRelations = relations(cityApplications, ({ one }) => ({
	hotel: one(hotels, { fields: [cityApplications.hotelId], references: [hotels.id] })
}));

export type CityApplication = typeof cityApplications.$inferSelect;
