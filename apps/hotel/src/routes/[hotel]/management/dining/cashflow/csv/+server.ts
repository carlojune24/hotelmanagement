import { toCsv } from '$lib/server/finance/calc';
import { requireCap } from '$lib/server/auth/rbac';
import { diningCashflowReport } from '$lib/server/dining-cashflow';
import { buildCashflowDoc, docToCsv } from '$lib/dining-report-doc';
import { localParts } from '$lib/dining-slots';
import { resolveRange } from '$lib/dining-sales-range';
import type { RequestHandler } from './$types';

/** The Cashflow tab as a CSV, drawn from the same document model as the printed sheet (every movement included). */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotel = locals.hotel!;
	const today = localParts(new Date(), hotel.timezone).date;
	const { from, to } = resolveRange(url, today);
	const r = await diningCashflowReport(hotel.id, from, to, { movementLimit: null });

	const { headers, rows } = docToCsv(buildCashflowDoc(r, { from, to, timezone: hotel.timezone }));
	// A byte-order mark so Excel reads the peso text and dashes as UTF-8.
	return new Response('﻿' + toCsv(headers, rows), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="dining-cashflow-${from}-to-${to}.csv"`,
			'cache-control': 'no-store'
		}
	});
};
