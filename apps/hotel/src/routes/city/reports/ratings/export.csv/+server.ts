import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import { toCsv } from '$lib/server/finance/calc';
import { ratingsForRequest } from '$lib/server/city/ratings';
import { ratingsCsvRows } from '$lib/city/ratings';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	requirePlatformAdmin(locals.user);
	const { range, report } = await ratingsForRequest(url.searchParams);
	const { headers, rows } = ratingsCsvRows(report);
	return new Response(toCsv(headers, rows), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="city-ratings-${range.from}_to_${range.to}.csv"`
		}
	});
};
