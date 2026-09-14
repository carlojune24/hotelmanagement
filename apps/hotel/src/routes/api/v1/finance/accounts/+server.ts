import { and, asc, eq, gt, gte, inArray, or } from 'drizzle-orm';
import { cursorQuery, pageSchema, MM_STANDARD_VERSION } from '@mm/integration';
import { z } from 'zod';
import { db } from '$lib/server/db/index';
import { chartOfAccounts } from '$lib/server/db/schema/index';
import { withApiKey } from '$lib/server/api/v1-response';
import { encodeCursor, decodeCursor } from '$lib/server/api/cursor';
import type { RequestHandler } from './$types';

const accountItem = z.object({
	id: z.string().uuid(),
	account_ref: z.string(),
	hotel_id: z.string().uuid(),
	code: z.string(),
	name: z.string(),
	type: z.string(),
	subtype: z.string(),
	normal_balance: z.string(),
	is_postable: z.boolean(),
	is_active: z.boolean(),
	updated_at: z.string(),
	deleted_at: z.string().nullable()
});
const page = pageSchema(accountItem);

export const GET: RequestHandler = (event) =>
	withApiKey(event, async (_auth, hotelIds) => {
		const q = cursorQuery.parse(Object.fromEntries(event.url.searchParams));
		const cursor = decodeCursor(q.cursor ?? null);

		const conds = [inArray(chartOfAccounts.hotelId, hotelIds)];
		if (q.updated_since) conds.push(gte(chartOfAccounts.updatedAt, new Date(q.updated_since)));
		if (cursor) {
			conds.push(
				or(
					gt(chartOfAccounts.updatedAt, new Date(cursor.updatedAt)),
					and(eq(chartOfAccounts.updatedAt, new Date(cursor.updatedAt)), gt(chartOfAccounts.id, cursor.id))
				)!
			);
		}

		const rows = await db
			.select()
			.from(chartOfAccounts)
			.where(and(...conds))
			.orderBy(asc(chartOfAccounts.updatedAt), asc(chartOfAccounts.id))
			.limit(q.limit + 1);

		const hasMore = rows.length > q.limit;
		const pageRows = hasMore ? rows.slice(0, q.limit) : rows;
		const last = pageRows.at(-1);

		return page.parse({
			data: pageRows.map((a) => ({
				id: a.id,
				account_ref: a.accountRef,
				hotel_id: a.hotelId,
				code: a.code,
				name: a.name,
				type: a.type,
				subtype: a.subtype,
				normal_balance: a.normalBalance,
				is_postable: a.isPostable,
				is_active: a.isActive,
				updated_at: a.updatedAt.toISOString(),
				deleted_at: null
			})),
			next_cursor:
				hasMore && last ? encodeCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id }) : null,
			standard_version: MM_STANDARD_VERSION
		});
	});
