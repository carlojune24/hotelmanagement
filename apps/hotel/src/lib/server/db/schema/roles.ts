import { relations } from 'drizzle-orm';
import { boolean, index, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';

/**
 * DB-backed roles — replaces the static `MembershipRole` enum as the live authorization
 * source (see `apps/hotel/src/lib/authz.ts`). Fully hotel-scoped: there are no nullable
 * "global template" rows — every hotel carries `hotel_id` per this codebase's tenant
 * convention, and a nullable-hotelId template would break `(hotel_id, slug)` uniqueness
 * (Postgres treats NULLs as distinct) and force an `OR hotel_id IS NULL` branch on every
 * read. Instead, "templates" live in code: `ROLE_CAPS` in `authz.ts` is seed data, copied
 * into concrete per-hotel rows by `seedDefaultRoles` at hotel-creation time.
 */
export const roles = pgTable(
	'roles',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		/** Stable key (e.g. 'hotel_admin', 'front_desk', or a slugified custom name). Invites
		 *  store this, not the row id, so an invite survives a role rename. */
		slug: text('slug').notNull(),
		name: text('name').notNull(),
		description: text('description'),
		/** True only for a hotel's `hotel_admin` row — always full access, not editable or
		 *  deletable, so a hotel can never lock itself out of its own hotel. */
		isProtected: boolean('is_protected').notNull().default(false),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [
		uniqueIndex('roles_hotel_slug_idx').on(t.hotelId, t.slug),
		index('roles_hotel_idx').on(t.hotelId)
	]
);

export const rolePermissions = pgTable(
	'role_permissions',
	{
		roleId: uuid('role_id')
			.notNull()
			.references(() => roles.id, { onDelete: 'cascade' }),
		/** e.g. 'booking:*', 'finance:read', '*' — see `PERMISSION_CATALOG` in `authz.ts`. */
		capability: text('capability').notNull()
	},
	(t) => [primaryKey({ columns: [t.roleId, t.capability] })]
);

export const rolesRelations = relations(roles, ({ one, many }) => ({
	hotel: one(hotels, { fields: [roles.hotelId], references: [hotels.id] }),
	permissions: many(rolePermissions)
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
	role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] })
}));

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type RolePermission = typeof rolePermissions.$inferSelect;
