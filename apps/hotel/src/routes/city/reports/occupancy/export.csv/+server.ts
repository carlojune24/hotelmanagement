import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import { toCsv } from '$lib/server/finance/calc';
import { occupancyForRequest } from '$lib/server/city/occupancy';
import { occupancyCsvRows } from '$lib/city/occupancy';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	requirePlatformAdmin(locals.user);
	const { range, report } = await occupancyForRequest(url.searchParams);
	const { headers, rows } = occupancyCsvRows(report);
	return new Response(toCsv(headers, rows), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="city-occupancy-${range.from}_to_${range.to}.csv"`
		}
	});
};
