import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk } from './_shared';

/** Append-only record of every mutation. Written by the mutation, never updated. */
export const auditLog = pgTable(
	'audit_log',
	{
		id: pk(),
		/** Null for organization-level actions. */
		establishmentId: uuid('establishment_id'),
		actorUserId: uuid('actor_user_id'),
		actorLabel: text('actor_label'),
		action: text('action').notNull(),
		entityType: text('entity_type').notNull(),
		entityId: text('entity_id'),
		before: jsonb('before'),
		after: jsonb('after'),
		createdAt: createdAt()
	},
	(t) => [index('audit_entity_idx').on(t.entityType, t.entityId)]
);
