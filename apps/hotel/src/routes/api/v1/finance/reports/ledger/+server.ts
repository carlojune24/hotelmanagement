import { z } from 'zod';
import { plainDate } from '@mm/integration';
import { generalLedger } from '$lib/server/finance/ledger-reports';
import { withApiKey } from '$lib/server/api/v1-response';
import type { RequestHandler } from './$types';

const query = z.object({ account_id: z.string().uuid(), date_from: plainDate, date_to: plainDate });

export const GET: RequestHandler = (event) =>
	withApiKey(event, async (_auth, hotelIds) => {
		const q = query.parse(Object.fromEntries(event.url.searchParams));
		const rows = await generalLedger({
			hotelIds,
			dateFrom: q.date_from,
			dateTo: q.date_to,
			accountId: q.account_id
		});
		return { data: rows };
	});
