import { and, desc, eq, gte, ilike, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { auditLog, type AuditLog } from '$lib/server/db/schema/index';
import type { SessionUser } from '$lib/server/auth/session';
import { getRequestContext } from '$lib/server/request-context';
import { zonedToUtc } from '$lib/dining-slots';
import { addDays } from '$lib/dining-sales-range';

export type AuditActorKind = 'staff' | 'guest' | 'system';
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const clip = (v: string | null | undefined, n: number) => (v ? v.slice(0, n) : null);

/** Who did it, when the caller doesn't say. A signed-in user is staff; a webhook or background
 *  path (`/api/**`, or no request at all) is the system; any other public request is a guest. */
function inferActorKind(actor: SessionUser | null | undefined): AuditActorKind {
	if (actor) return 'staff';
	const ctx = getRequestContext();
	if (!ctx) return 'system';
	if (ctx.path.startsWith('/api/')) return 'system';
	return 'guest';
}

/**
 * Records one mutation. Pass `tx` from inside a transaction so the entry commits or rolls back
 * with the change (otherwise it goes through the global `db` and can outlive a rollback).
 * `refCode` is the tracking number (DN- / TB- …) the entry belongs to; the request's IP and
 * browser are picked up automatically from the request context.
 */
export async function writeAudit(input: {
	hotelId?: string | null;
	actor?: SessionUser | null;
	action: string;
	entityType: string;
	entityId?: string | null;
	before?: unknown;
	after?: unknown;
	refCode?: string | null;
	actorKind?: AuditActorKind;
	tx?: Tx;
}) {
	const ctx = getRequestContext();
	await (input.tx ?? db).insert(auditLog).values({
		hotelId: input.hotelId ?? null,
		actorUserId: input.actor?.id ?? null,
		actorLabel: input.actor ? `${input.actor.name} <${input.actor.email}>` : null,
		actorKind: input.actorKind ?? inferActorKind(input.actor),
		action: input.action,
		entityType: input.entityType,
		entityId: input.entityId ?? null,
		before: (input.before ?? null) as object | null,
		after: (input.after ?? null) as object | null,
		refCode: input.refCode ?? null,
		ipAddress: clip(ctx?.ip, 64),
		userAgent: clip(ctx?.userAgent, 300)
	});
}

export const AUDIT_PAGE_SIZE = 50;
/** The most rows a CSV or printed register will carry, so one click cannot read the whole table. */
export const AUDIT_EXPORT_MAX = 5000;

export interface AuditFilter {
	/** Hotel-local dates, inclusive. */
	from?: string;
	to?: string;
	action?: string;
	/** A staff user id, or `kind:guest` / `kind:system` / `kind:staff`. */
	actor?: string;
	entityType?: string;
	/** A tracking number (DN-…, TB-…), an entity id (or its first characters), or words from the actor / action. */
	q?: string;
	page?: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Reads the audit page's query string. Anything malformed is simply ignored. */
export function parseAuditFilter(params: URLSearchParams): AuditFilter {
	const get = (k: string) => params.get(k)?.trim() || undefined;
	const from = get('from');
	const to = get('to');
	const page = Number.parseInt(params.get('page') ?? '1', 10);
	return {
		from: from && DATE_RE.test(from) ? from : undefined,
		to: to && DATE_RE.test(to) ? to : undefined,
		action: get('action')?.slice(0, 80),
		actor: get('actor')?.slice(0, 80),
		entityType: get('entityType')?.slice(0, 80),
		q: get('q')?.slice(0, 60),
		page: Number.isFinite(page) && page > 0 ? Math.min(page, 100000) : 1
	};
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function auditWhere(hotelId: string, f: AuditFilter, timezone: string) {
	const conds = [eq(auditLog.hotelId, hotelId)];
	if (f.from) conds.push(gte(auditLog.createdAt, zonedToUtc(f.from, '00:00', timezone)));
	// Inclusive of the whole last day.
	if (f.to) conds.push(lt(auditLog.createdAt, zonedToUtc(addDays(f.to, 1), '00:00', timezone)));
	if (f.action) conds.push(eq(auditLog.action, f.action));
	if (f.entityType) conds.push(eq(auditLog.entityType, f.entityType));
	if (f.actor) {
		if (f.actor.startsWith('kind:')) {
			const kind = f.actor.slice(5);
			// Staff means a signed-in user; the other two are the rows with no user attached.
			if (kind === 'staff') conds.push(isNotNull(auditLog.actorUserId));
			else if (kind === 'guest' || kind === 'system') conds.push(and(isNull(auditLog.actorUserId), eq(auditLog.actorKind, kind))!);
		} else if (UUID_RE.test(f.actor)) {
			conds.push(eq(auditLog.actorUserId, f.actor));
		}
	}
	if (f.q) {
		const q = f.q;
		const like = `%${likeEscape(q)}%`;
		conds.push(
			or(
				eq(auditLog.refCode, q.toUpperCase()),
				ilike(sql`${auditLog.entityId}::text`, `${likeEscape(q)}%`),
				ilike(auditLog.actorLabel, like),
				ilike(auditLog.action, like)
			)!
		);
	}
	return and(...conds);
}

/** One page of audit entries for a hotel, newest first, narrowed on the server. */
export async function queryAuditLog(
	hotelId: string,
	filter: AuditFilter,
	timezone: string
): Promise<{ entries: AuditLog[]; total: number; page: number; pages: number }> {
	const where = auditWhere(hotelId, filter, timezone);
	const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)` }).from(auditLog).where(where);
	const total = Number(n);
	const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
	const page = Math.min(filter.page ?? 1, pages);
	const entries = await db
		.select()
		.from(auditLog)
		.where(where)
		.orderBy(desc(auditLog.createdAt))
		.limit(AUDIT_PAGE_SIZE)
		.offset((page - 1) * AUDIT_PAGE_SIZE);
	return { entries, total, page, pages };
}

/** Every entry the filter matches (capped), oldest first, for the CSV and the printed register. */
export async function exportAuditLog(hotelId: string, filter: AuditFilter, timezone: string): Promise<{ entries: AuditLog[]; truncated: boolean }> {
	const rows = await db
		.select()
		.from(auditLog)
		.where(auditWhere(hotelId, filter, timezone))
		.orderBy(desc(auditLog.createdAt))
		.limit(AUDIT_EXPORT_MAX + 1);
	const truncated = rows.length > AUDIT_EXPORT_MAX;
	return { entries: rows.slice(0, AUDIT_EXPORT_MAX).reverse(), truncated };
}

/** Staff who have entries, for the actor filter. */
export async function listAuditActors(hotelId: string): Promise<{ id: string; label: string }[]> {
	const rows = await db
		.selectDistinct({ id: auditLog.actorUserId, label: auditLog.actorLabel })
		.from(auditLog)
		.where(and(eq(auditLog.hotelId, hotelId), isNotNull(auditLog.actorUserId)))
		.orderBy(auditLog.actorLabel);
	const seen = new Set<string>();
	const out: { id: string; label: string }[] = [];
	for (const r of rows) {
		if (!r.id || seen.has(r.id)) continue;
		seen.add(r.id);
		out.push({ id: r.id, label: (r.label ?? r.id).split(' <')[0]! });
	}
	return out;
}

/** Distinct actions this hotel has entries for, for the action filter. */
export async function listAuditActions(hotelId: string): Promise<string[]> {
	const rows = await db.selectDistinct({ action: auditLog.action }).from(auditLog).where(eq(auditLog.hotelId, hotelId)).orderBy(auditLog.action);
	return rows.map((r) => r.action);
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
