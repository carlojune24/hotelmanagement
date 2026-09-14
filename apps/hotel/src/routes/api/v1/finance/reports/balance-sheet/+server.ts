import { z } from 'zod';
import { plainDate } from '@mm/integration';
import { balanceSheet } from '$lib/server/finance/ledger-reports';
import { withApiKey } from '$lib/server/api/v1-response';
import type { RequestHandler } from './$types';

const query = z.object({ date_to: plainDate });

export const GET: RequestHandler = (event) =>
	withApiKey(event, async (_auth, hotelIds) => {
		const q = query.parse(Object.fromEntries(event.url.searchParams));
		// balanceSheet is a point-in-time snapshot; dateFrom only bounds nothing here,
		// but the shared ReportParams shape requires it — the account-inception lower
		// bound is intentional and internal to ledger-reports.ts's implementation.
		const rows = await balanceSheet({ hotelIds, dateFrom: '1900-01-01', dateTo: q.date_to });
		return { data: rows };
	});
