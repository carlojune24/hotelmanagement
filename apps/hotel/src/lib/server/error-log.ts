import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from './db/index';
import { errorLog, hotels } from './db/schema/index';

/** Keeps a single stack trace from bloating the table indefinitely. */
const MAX_STACK_LENGTH = 8_000;

/** How many recent rows the list view scans before grouping — bounds the query
 *  for an admin-diagnostic tool rather than paginating the raw table in SQL. A
 *  hotel/route filter still narrows this at the DB level first. */
const GROUPING_WINDOW = 2_000;

export const ERROR_LOG_PAGE_SIZE = 25;
/** How long a row survives before `runErrorLogRetention` sweeps it. */
export const ERROR_LOG_RETENTION_DAYS = 90;

export interface ErrorLogEntry {
	ref: string;
	method: string;
	path: string;
	routeId: string | null;
	userId: string | null;
	hotelId: string | null;
	message: string;
	stack: string | null;
}

/** Best-effort write — never throws. Call from `handleError` only; a failure here
 *  must not turn one error into two, so it logs to the console and returns. */
export async function writeErrorLog(entry: ErrorLogEntry): Promise<void> {
	try {
		await db.insert(errorLog).values({
			...entry,
			stack: entry.stack?.slice(0, MAX_STACK_LENGTH) ?? null
		});
	} catch (err) {
		console.error('[error-log] failed to write:', err);
	}
}

export interface ErrorLogFilters {
	hotelId?: string;
	routeId?: string;
	page: number;
}

export interface ErrorLogGroup {
	routeId: string | null;
	message: string;
	occurrences: number;
	firstSeen: Date;
	lastSeen: Date;
	/** The most recent occurrence's own ref — what a group row links to. */
	latestRef: string;
	hotelId: string | null;
	hotelName: string | null;
}

/** Recent errors, most-recent-first, grouped by (route, message) so a repeating
 *  failure shows as one row with a count rather than flooding the list. */
export async function listErrorLogGroups(
	filters: ErrorLogFilters
): Promise<{ groups: ErrorLogGroup[]; total: number }> {
	const where = and(
		filters.hotelId ? eq(errorLog.hotelId, filters.hotelId) : undefined,
		filters.routeId ? eq(errorLog.routeId, filters.routeId) : undefined
	);

	const rows = await db
		.select({
			ref: errorLog.ref,
			routeId: errorLog.routeId,
			message: errorLog.message,
			occurredAt: errorLog.occurredAt,
			hotelId: errorLog.hotelId,
			hotelName: hotels.name
		})
		.from(errorLog)
		.leftJoin(hotels, eq(errorLog.hotelId, hotels.id))
		.where(where)
		.orderBy(desc(errorLog.occurredAt))
		.limit(GROUPING_WINDOW);

	// Rows arrive newest-first, so the first row seen for a key already carries
	// that group's lastSeen/latestRef; only firstSeen and the running count update.
	const byKey = new Map<string, ErrorLogGroup>();
	for (const r of rows) {
		const key = `${r.routeId ?? ''}\u0000${r.message}`;
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, {
				routeId: r.routeId,
				message: r.message,
				occurrences: 1,
				firstSeen: r.occurredAt,
				lastSeen: r.occurredAt,
				latestRef: r.ref,
				hotelId: r.hotelId,
				hotelName: r.hotelName
			});
		} else {
			existing.occurrences++;
			if (r.occurredAt < existing.firstSeen) existing.firstSeen = r.occurredAt;
		}
	}

	const all = [...byKey.values()].sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
	const start = (filters.page - 1) * ERROR_LOG_PAGE_SIZE;
	return { groups: all.slice(start, start + ERROR_LOG_PAGE_SIZE), total: all.length };
}

export interface ErrorLogDetail extends ErrorLogEntry {
	id: string;
	occurredAt: Date;
	hotelName: string | null;
}

const detailColumns = {
	id: errorLog.id,
	ref: errorLog.ref,
	occurredAt: errorLog.occurredAt,
	method: errorLog.method,
	path: errorLog.path,
	routeId: errorLog.routeId,
	userId: errorLog.userId,
	hotelId: errorLog.hotelId,
	message: errorLog.message,
	stack: errorLog.stack,
	hotelName: hotels.name
};

/** One occurrence by its ref, plus every sibling sharing the same (route, message)
 *  fingerprint — newest first, the looked-up ref excluded. */
export async function getErrorLogByRef(
	ref: string
): Promise<{ entry: ErrorLogDetail; siblings: ErrorLogDetail[] } | null> {
	const [row] = await db
		.select(detailColumns)
		.from(errorLog)
		.leftJoin(hotels, eq(errorLog.hotelId, hotels.id))
		.where(eq(errorLog.ref, ref));

	if (!row) return null;

	const siblingRows = await db
		.select(detailColumns)
		.from(errorLog)
		.leftJoin(hotels, eq(errorLog.hotelId, hotels.id))
		.where(
			and(
				row.routeId ? eq(errorLog.routeId, row.routeId) : sql`${errorLog.routeId} is null`,
				eq(errorLog.message, row.message)
			)
		)
		.orderBy(desc(errorLog.occurredAt))
		.limit(50);

	return { entry: row, siblings: siblingRows.filter((s) => s.ref !== ref) };
}

/** For the hotel filter dropdown — only hotels that have actually logged an error. */
export async function listErrorLogHotels(): Promise<{ id: string; name: string }[]> {
	return db
		.selectDistinct({ id: hotels.id, name: hotels.name })
		.from(errorLog)
		.innerJoin(hotels, eq(errorLog.hotelId, hotels.id))
		.orderBy(hotels.name);
}

/** For the route filter dropdown. */
export async function listErrorLogRoutes(): Promise<string[]> {
	const rows = await db
		.selectDistinct({ routeId: errorLog.routeId })
		.from(errorLog)
		.where(sql`${errorLog.routeId} is not null`)
		.orderBy(errorLog.routeId);
	return rows.map((r) => r.routeId).filter((id): id is string => !!id);
}

/** Sweeps rows past the retention window. Run daily from the job runner. */
export async function runErrorLogRetention(): Promise<{ deleted: number }> {
	const cutoff = new Date(Date.now() - ERROR_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
	const deleted = await db
		.delete(errorLog)
		.where(lt(errorLog.occurredAt, cutoff))
		.returning({ id: errorLog.id });
	return { deleted: deleted.length };
}
