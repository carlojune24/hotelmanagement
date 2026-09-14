import { z } from 'zod';
import { plainDate } from '@mm/integration';
import { trialBalance } from '$lib/server/finance/ledger-reports';
import { withApiKey } from '$lib/server/api/v1-response';
import type { RequestHandler } from './$types';

const query = z.object({ date_from: plainDate, date_to: plainDate });

export const GET: RequestHandler = (event) =>
	withApiKey(event, async (_auth, hotelIds) => {
		const q = query.parse(Object.fromEntries(event.url.searchParams));
		const rows = await trialBalance({ hotelIds, dateFrom: q.date_from, dateTo: q.date_to });
		return { data: rows };
	});
