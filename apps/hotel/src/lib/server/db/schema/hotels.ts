import { relations } from 'drizzle-orm';
import {
	bigint,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	time,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, pk, updatedAt } from './_shared';
import { users } from './auth';

/**
 * Owner / portfolio layer above hotels. Populated in Phase 6; the column exists
 * from the start so tenant tables never need reshaping.
 */
export const hotelGroups = pgTable('hotel_groups', {
	id: pk(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

export const hotelStatus = pgEnum('hotel_status', ['draft', 'published', 'archived']);

export const hotels = pgTable(
	'hotels',
	{
		id: pk(),
		/** URL segment: `/{slug}/…`. Lowercase, validated against reserved prefixes. */
		slug: text('slug').notNull().unique(),
		groupId: uuid('group_id').references(() => hotelGroups.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		legalName: text('legal_name'),
		/** Cross-app legal-entity reference (org_<ULID>) — see docs/standards. */
		orgRef: text('org_ref').notNull().unique(),
		addressLine: text('address_line'),
		city: text('city'),
		timezone: text('timezone').notNull().default('Asia/Manila'),
		currency: text('currency').notNull().default('PHP'),
		/** VAT rate in basis points (1200 = 12%). */
		vatRateBps: integer('vat_rate_bps').notNull().default(1200),
		orSeriesPrefix: text('or_series_prefix').notNull().default('OR'),
		/** A client's own domain (bare hostname, e.g. "mmhotel.com" — no protocol/path), mapped to this
		 *  hotel's slug by `hooks.server.ts`'s `reroute` hook. Null = reached only via the platform's own
		 *  `/{slug}/…` path. DNS/hosting for the domain itself is set up outside this app. */
		customDomain: text('custom_domain').unique(),
		/** Standard check-in/check-out clock time, published as policy — not enforced against actual check-in/check-out actions. */
		checkInTime: time('check_in_time').notNull().default('14:00:00'),
		checkOutTime: time('check_out_time').notNull().default('12:00:00'),
		/** Per-hour rate for a late checkout or early check-in, chargeable to a booking's folio
		 *  (`lib/server/folio.ts`'s `addExtensionFeeCharge`) — how many hours late/early is judged
		 *  by front desk, not tracked anywhere, so this is a rate, not a total. */
		lateCheckoutFeePerHourCentavos: bigint('late_checkout_fee_per_hour_centavos', { mode: 'number' })
			.notNull()
			.default(0),
		earlyCheckInFeePerHourCentavos: bigint('early_check_in_fee_per_hour_centavos', { mode: 'number' })
			.notNull()
			.default(0),
		/** Free-form per-hotel configuration (branding, policies, defaults). */
		config: jsonb('config').notNull().default({}),
		status: hotelStatus('status').notNull().default('draft'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: deletedAt()
	},
	(t) => [index('hotels_group_idx').on(t.groupId)]
);

export const membershipRole = pgEnum('membership_role', [
	'hotel_admin',
	'front_desk',
	'housekeeping',
	'accountant',
	'hr',
	'read_only',
	'group_owner'
]);

export const memberships = pgTable(
	'memberships',
	{
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		role: membershipRole('role').notNull(),
		createdAt: createdAt()
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.hotelId] }),
		uniqueIndex('memberships_hotel_user_idx').on(t.hotelId, t.userId)
	]
);

export const hotelsRelations = relations(hotels, ({ one, many }) => ({
	group: one(hotelGroups, { fields: [hotels.groupId], references: [hotelGroups.id] }),
	memberships: many(memberships)
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
	user: one(users, { fields: [memberships.userId], references: [users.id] }),
	hotel: one(hotels, { fields: [memberships.hotelId], references: [hotels.id] })
}));

export type Hotel = typeof hotels.$inferSelect;
export type NewHotel = typeof hotels.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type HotelGroup = typeof hotelGroups.$inferSelect;
