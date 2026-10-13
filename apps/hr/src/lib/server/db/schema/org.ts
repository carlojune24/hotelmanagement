import { index, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, updatedAt } from './_shared';
import { users } from './auth';

/**
 * The company. One row today; kept as a table so `establishments` and memberships have a
 * real parent and the model stays portable (docs/HR_PLAN.md §6).
 */
export const organizations = pgTable('organizations', {
	id: pk(),
	/** `org_<ULID>` cross-app reference. */
	orgRef: text('org_ref').notNull().unique(),
	name: text('name').notNull(),
	legalName: text('legal_name'),
	tin: text('tin'),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

/**
 * A business HR is run for: a hotel (identified by that hotel's `hotels.org_ref` in the hotel
 * app) or a non-hotel business that exists only here. Replaces the old `hotel_id` FK.
 */
export const establishments = pgTable(
	'establishments',
	{
		id: pk(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'restrict' }),
		/** For kind=hotel: the hotel app's `hotels.org_ref`. For a business: minted here. */
		orgRef: text('org_ref').notNull().unique(),
		name: text('name').notNull(),
		/** 'hotel' | 'business' — validated at the app layer. */
		kind: text('kind').notNull(),
		/** IANA timezone; DTR business dates and roster weeks resolve from it. */
		timezone: text('timezone').notNull().default('Asia/Manila'),
		/** 'active' | 'archived' */
		status: text('status').notNull().default('active'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [index('establishments_org_idx').on(t.organizationId)]
);

/** Organization-wide role (Main HR, owner read-only). One per user. */
export const orgMemberships = pgTable(
	'org_memberships',
	{
		userId: uuid('user_id')
			.notNull()
			.primaryKey()
			.references(() => users.id, { onDelete: 'cascade' }),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		/** 'main_hr' | 'owner_readonly' — see `lib/authz.ts`. */
		role: text('role').notNull(),
		createdAt: createdAt()
	}
);

/** Per-establishment role (business manager, HR clerk). */
export const establishmentMemberships = pgTable(
	'establishment_memberships',
	{
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		establishmentId: uuid('establishment_id')
			.notNull()
			.references(() => establishments.id, { onDelete: 'cascade' }),
		/** 'business_manager' | 'hr_clerk' */
		role: text('role').notNull(),
		createdAt: createdAt()
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.establishmentId] }),
		uniqueIndex('establishment_memberships_est_user_idx').on(t.establishmentId, t.userId)
	]
);

export type Organization = typeof organizations.$inferSelect;
export type Establishment = typeof establishments.$inferSelect;
