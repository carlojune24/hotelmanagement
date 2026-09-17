import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { reportCsv, runReport } from '$lib/server/finance/report-runner';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	requireCap(locals.user, locals.role, 'reports:read');
	const hotel = locals.hotel!;
	const result = await runReport(hotel.id, params.slug, {
		timezone: hotel.timezone,
		date: url.searchParams.get('date') || undefined,
		from: url.searchParams.get('from') || undefined,
		to: url.searchParams.get('to') || undefined
	});
	if (!result) error(404, 'Unknown report');

	return new Response(reportCsv(result), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${params.slug}-${new Date().toISOString().slice(0, 10)}.csv"`
		}
	});
};
