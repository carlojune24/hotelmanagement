import { MM_STANDARD_VERSION } from '@mm/integration';
import { withApiKey } from '$lib/server/api/v1-response';
import { ApiError } from '$lib/server/api/api-error';
import { dailyStatsFor } from '$lib/server/api/daily-stats';
import { validateRange } from '$lib/daily-stats';
import { businessDateFor } from '$lib/server/finance/shared';
import { addDays } from '$lib/finance-range';
import type { RequestHandler } from './$types';

/**
 * Per-hotel, per-business-date operating stats (occupancy inputs, arrivals, tourists, cash by category) —
 * aggregates only, no guest data. Not cursor-paginated: a bounded date range (max 400 days) per request.
 * `from`/`to` default to the last 31 days. Safe to re-pull: a day's numbers can change until it settles.
 */
export const GET: RequestHandler = (event) =>
	withApiKey(event, async (_auth, hotelIds) => {
		const p = event.url.searchParams;
		const today = businessDateFor('Asia/Manila');
		const range = validateRange(p.get('from') ?? addDays(today, -30), p.get('to') ?? today);
		if (!range.ok) throw new ApiError(400, range.message);
		return {
			data: await dailyStatsFor(hotelIds, range.from, range.to),
			generated_at: new Date().toISOString(),
			standard_version: MM_STANDARD_VERSION
		};
	});
