import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import { toCsv } from '$lib/server/finance/calc';
import { visitorsForRequest } from '$lib/server/city/visitors';
import { visitorsCsvRows } from '$lib/city/visitors';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	requirePlatformAdmin(locals.user);
	const { range, report } = await visitorsForRequest(url.searchParams);
	const { headers, rows } = visitorsCsvRows(report);
	return new Response(toCsv(headers, rows), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="city-guests-${range.from}_to_${range.to}.csv"`
		}
	});
};
