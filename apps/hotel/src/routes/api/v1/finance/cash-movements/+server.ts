import { and, asc, eq, gt, gte, inArray, or } from 'drizzle-orm';
import { cursorQuery, pageSchema, MM_STANDARD_VERSION } from '@mm/integration';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { cashMovements } from '$lib/server/db/schema/index';
import { withApiKey } from '$lib/server/api/v1-response';
import { encodeCursor, decodeCursor } from '$lib/server/api/cursor';
import type { RequestHandler } from './$types';

const cashMovementItem = z.object({
	id: z.string().uuid(),
	hotel_id: z.string().uuid(),
	business_date: z.string(),
	direction: z.string(),
	category: z.string(),
	cash_account_id: z.string().uuid(),
	amount_minor: z.number().int(),
	journal_entry_id: z.string().uuid().nullable(),
	source_type: z.string(),
	source_id: z.string().uuid().nullable(),
	updated_at: z.string(),
	deleted_at: z.string().nullable()
});
const page = pageSchema(cashMovementItem);

/**
 * `cash_movements` has no `updated_at`/`deleted_at` matching `@mm/integration`'s
 * `syncableMeta` — it's append-then-soft-void, not edit-in-place. We synthesize
 * both here, at the API boundary only: `updated_at` is `voided_at ?? created_at`
 * (a void is the only thing that ever "changes" a row) and a voided row presents as
 * `deleted_at` set, so a naive external summer drops it automatically. Pagination
 * cursors on this synthesized `updated_at`, so a void moves a row to the end of the
 * feed — the correct behavior for incremental sync.
 */
export const GET: RequestHandler = (event) =>
	withApiKey(event, async (_auth, hotelIds) => {
		const q = cursorQuery.parse(Object.fromEntries(event.url.searchParams));
		const cursor = decodeCursor(q.cursor ?? null);

		const conds = [inArray(cashMovements.hotelId, hotelIds)];
		// updated_since / cursor compare against created_at as a floor — a void always
		// moves updated_at forward from created_at, never earlier, so filtering on
		// created_at here cannot skip a row whose true (voided) updated_at is later.
		if (q.updated_since) conds.push(gte(cashMovements.createdAt, new Date(q.updated_since)));
		if (cursor) {
			conds.push(
				or(
					gt(cashMovements.createdAt, new Date(cursor.updatedAt)),
					and(eq(cashMovements.createdAt, new Date(cursor.updatedAt)), gt(cashMovements.id, cursor.id))
				)!
			);
		}

		const rows = await db
			.select()
			.from(cashMovements)
			.where(and(...conds))
			.orderBy(asc(cashMovements.createdAt), asc(cashMovements.id))
			.limit(q.limit + 1);

		const hasMore = rows.length > q.limit;
		const pageRows = hasMore ? rows.slice(0, q.limit) : rows;
		const last = pageRows.at(-1);

		return page.parse({
			data: pageRows.map((m) => {
				const updatedAt = (m.voidedAt ?? m.createdAt).toISOString();
				return {
					id: m.id,
					hotel_id: m.hotelId,
					business_date: m.businessDate,
					direction: m.direction,
					category: m.category,
					cash_account_id: m.cashAccountId,
					amount_minor: m.amountCentavos,
					journal_entry_id: m.journalEntryId,
					source_type: m.sourceType,
					source_id: m.sourceId,
					updated_at: updatedAt,
					deleted_at: m.voidedAt ? m.voidedAt.toISOString() : null
				};
			}),
			next_cursor:
				hasMore && last ? encodeCursor({ updatedAt: last.createdAt.toISOString(), id: last.id }) : null,
			standard_version: MM_STANDARD_VERSION
		});
	});
