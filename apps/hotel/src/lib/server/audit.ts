import { db } from '$lib/server/db/index';
import { auditLog } from '$lib/server/db/schema/index';
import type { SessionUser } from '$lib/server/auth/session';

export async function writeAudit(input: {
	hotelId?: string | null;
	actor?: SessionUser | null;
	action: string;
	entityType: string;
	entityId?: string | null;
	before?: unknown;
	after?: unknown;
}) {
	await db.insert(auditLog).values({
		hotelId: input.hotelId ?? null,
		actorUserId: input.actor?.id ?? null,
		actorLabel: input.actor ? `${input.actor.name} <${input.actor.email}>` : null,
		action: input.action,
		entityType: input.entityType,
		entityId: input.entityId ?? null,
		before: (input.before ?? null) as object | null,
		after: (input.after ?? null) as object | null
	});
}
