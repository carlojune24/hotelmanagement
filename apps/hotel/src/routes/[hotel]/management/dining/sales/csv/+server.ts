import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { diningItems } from '$lib/server/db/schema/index';
import { toCsv } from '$lib/server/finance/calc';
import { requireCap } from '$lib/server/auth/rbac';
import { diningSalesReport } from '$lib/server/dining-orders';
import { buildSalesDoc, docToCsv } from '$lib/dining-report-doc';
import { localParts } from '$lib/dining-slots';
import { resolveRange } from '$lib/dining-sales-range';
import type { RequestHandler } from './$types';

/** The Sales tab as a CSV, drawn from the same document model as the printed sheet. */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotelId = locals.hotel!.id;
	const today = localParts(new Date(), locals.hotel!.timezone).date;
	const { from, to } = resolveRange(url, today);
	const venueParam = url.searchParams.get('venue');
	const venue =
		venueParam && /^[0-9a-f-]{36}$/i.test(venueParam)
			? await db
					.select({ id: diningItems.id, title: diningItems.title })
					.from(diningItems)
					.where(and(eq(diningItems.id, venueParam), eq(diningItems.hotelId, hotelId)))
					.limit(1)
					.then((r) => r.at(0) ?? null)
			: null;
	const r = await diningSalesReport(hotelId, from, to, venue?.id ?? null);

	const { headers, rows } = docToCsv(buildSalesDoc(r, { venueLabel: venue?.title ?? 'All venues' }));
	// A byte-order mark so Excel reads the peso text and dashes as UTF-8.
	return new Response('﻿' + toCsv(headers, rows), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="dining-sales-${from}-to-${to}.csv"`,
			'cache-control': 'no-store'
		}
	});
};
