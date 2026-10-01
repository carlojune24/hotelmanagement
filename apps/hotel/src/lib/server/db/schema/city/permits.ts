import { date, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from '../_shared';
import { hotels } from '../hotels';
import { users } from '../auth';
import { cityApplications } from './applications';

/**
 * A hotel's business permit. A renewal is a NEW row, so past permits stay as history; the hotel's
 * current permit is the one expiring latest. Lives only in the city DB (never re-exported from
 * `schema/index.ts`). `applicationId` is set when the row was copied from a finalized application.
 */
export const cityPermits = pgTable(
	'city_permits',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		permitNumber: text('permit_number').notNull(),
		issuedOn: date('issued_on', { mode: 'string' }),
		expiresOn: date('expires_on', { mode: 'string' }).notNull(),
		notes: text('notes'),
		applicationId: uuid('application_id').references(() => cityApplications.id, {
			onDelete: 'set null'
		}),
		recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('city_permits_hotel_expiry_idx').on(t.hotelId, t.expiresOn)]
);

export type CityPermit = typeof cityPermits.$inferSelect;
