import { and, asc, eq, gt, gte, inArray, or } from 'drizzle-orm';
import { cursorQuery, pageSchema, MM_STANDARD_VERSION } from '@mm/integration';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { journalEntries, journalLines } from '$lib/server/db/schema/index';
import { withApiKey } from '$lib/server/api/v1-response';
import { encodeCursor, decodeCursor } from '$lib/server/api/cursor';
import type { RequestHandler } from './$types';

const journalEntryItem = z.object({
	id: z.string().uuid(),
	hotel_id: z.string().uuid(),
	entry_no: z.string(),
	entry_date: z.string(),
	memo: z.string().nullable(),
	source_type: z.string(),
	source_id: z.string().uuid().nullable(),
	reversal_of_entry_id: z.string().uuid().nullable(),
	lines: z.array(
		z.object({
			account_id: z.string().uuid(),
			debit_minor: z.number().int(),
			credit_minor: z.number().int(),
			department: z.string().nullable(),
			cost_center: z.string().nullable(),
			project: z.string().nullable()
		})
	),
	updated_at: z.string(),
	deleted_at: z.string().nullable()
});
const page = pageSchema(journalEntryItem);

export const GET: RequestHandler = (event) =>
	withApiKey(event, async (_auth, hotelIds) => {
		const q = cursorQuery.parse(Object.fromEntries(event.url.searchParams));
		const cursor = decodeCursor(q.cursor ?? null);

		const conds = [inArray(journalEntries.hotelId, hotelIds)];
		if (q.updated_since) conds.push(gte(journalEntries.postedAt, new Date(q.updated_since)));
		if (cursor) {
			conds.push(
				or(
					gt(journalEntries.postedAt, new Date(cursor.updatedAt)),
					and(eq(journalEntries.postedAt, new Date(cursor.updatedAt)), gt(journalEntries.id, cursor.id))
				)!
			);
		}

		const entries = await db
			.select()
			.from(journalEntries)
			.where(and(...conds))
			.orderBy(asc(journalEntries.postedAt), asc(journalEntries.id))
			.limit(q.limit + 1);

		const hasMore = entries.length > q.limit;
		const pageEntries = hasMore ? entries.slice(0, q.limit) : entries;
		const last = pageEntries.at(-1);

		const entryIds = pageEntries.map((e) => e.id);
		const lines = entryIds.length
			? await db.select().from(journalLines).where(inArray(journalLines.journalEntryId, entryIds))
			: [];
		const linesByEntry = new Map<string, typeof lines>();
		for (const l of lines) {
			const arr = linesByEntry.get(l.journalEntryId) ?? [];
			arr.push(l);
			linesByEntry.set(l.journalEntryId, arr);
		}

		return page.parse({
			data: pageEntries.map((e) => ({
				id: e.id,
				hotel_id: e.hotelId,
				entry_no: e.entryNo,
				entry_date: e.entryDate,
				memo: e.memo,
				source_type: e.sourceType,
				source_id: e.sourceId,
				reversal_of_entry_id: e.reversalOfEntryId,
				lines: (linesByEntry.get(e.id) ?? []).map((l) => ({
					account_id: l.accountId,
					debit_minor: l.debitCentavos,
					credit_minor: l.creditCentavos,
					department: l.department,
					cost_center: l.costCenter,
					project: l.project
				})),
				updated_at: e.postedAt.toISOString(),
				deleted_at: null
			})),
			next_cursor:
				hasMore && last ? encodeCursor({ updatedAt: last.postedAt.toISOString(), id: last.id }) : null,
			standard_version: MM_STANDARD_VERSION
		});
	});
