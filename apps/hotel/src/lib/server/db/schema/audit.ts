import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk } from './_shared';

/** Append-only record of every mutation. Written by the mutation, never updated. */
export const auditLog = pgTable(
	'audit_log',
	{
		id: pk(),
		/** Null for platform-level actions. */
		hotelId: uuid('hotel_id'),
		actorUserId: uuid('actor_user_id'),
		actorLabel: text('actor_label'),
		action: text('action').notNull(),
		entityType: text('entity_type').notNull(),
		entityId: text('entity_id'),
		before: jsonb('before'),
		after: jsonb('after'),
		/** `staff` (a signed-in user did it), `guest` (a public visitor) or `system` (webhook,
		 *  background job, no request). Rows written before this column read `system`. */
		actorKind: text('actor_kind').notNull().default('system'),
		/** Where the request came from. Personal data for guests — shown to hotel admins only. */
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		/** The tracking number (DN- / TB- …) this entry belongs to, so a trail can find it. */
		refCode: text('ref_code'),
		createdAt: createdAt()
	},
	(t) => [
		index('audit_hotel_idx').on(t.hotelId),
		index('audit_hotel_created_idx').on(t.hotelId, t.createdAt),
		index('audit_ref_code_idx').on(t.refCode),
		index('audit_entity_idx').on(t.entityType, t.entityId)
	]
);

export type AuditLog = typeof auditLog.$inferSelect;
