import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** Standard primary key: UUID v4, generated in the database. */
export const pk = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () =>
	timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
	timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** Nullable soft-delete marker — required on every consolidatable entity. */
export const deletedAt = () => timestamp('deleted_at', { withTimezone: true });
