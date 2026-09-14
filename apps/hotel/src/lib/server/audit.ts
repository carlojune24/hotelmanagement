import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { auditLog, type AuditLog } from '$lib/server/db/schema/index';
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

/** Most recent audit entries for one hotel — the `/{slug}/settings/audit` viewer's only
 *  read path. `entityType` narrows server-side (cheap, indexed); free-text search over
 *  actor/action/entity stays client-side on this bounded page, same pattern the Emails
 *  list already uses. */
export async function listAuditLog(
	hotelId: string,
	opts: { entityType?: string; limit?: number } = {}
): Promise<AuditLog[]> {
	const conds = [eq(auditLog.hotelId, hotelId)];
	if (opts.entityType) conds.push(eq(auditLog.entityType, opts.entityType));
	return db
		.select()
		.from(auditLog)
		.where(and(...conds))
		.orderBy(desc(auditLog.createdAt))
		.limit(opts.limit ?? 300);
}

/** Distinct entity types this hotel actually has entries for, for the filter dropdown —
 *  narrower than the full static list of every `writeAudit` call site in the codebase. */
export async function listAuditEntityTypes(hotelId: string): Promise<string[]> {
	const rows = await db
		.selectDistinct({ entityType: auditLog.entityType })
		.from(auditLog)
		.where(eq(auditLog.hotelId, hotelId))
		.orderBy(auditLog.entityType);
	return rows.map((r) => r.entityType);
}
