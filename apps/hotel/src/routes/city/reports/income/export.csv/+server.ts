import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import { toCsv } from '$lib/server/finance/calc';
import { incomeForRequest } from '$lib/server/city/income';
import { incomeCsvRows } from '$lib/city/income';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	requirePlatformAdmin(locals.user);
	const { range, report } = await incomeForRequest(url.searchParams);
	const { headers, rows } = incomeCsvRows(report);
	return new Response(toCsv(headers, rows), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="city-income-${range.from}_to_${range.to}.csv"`
		}
	});
};
