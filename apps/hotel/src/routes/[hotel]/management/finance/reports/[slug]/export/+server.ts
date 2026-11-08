import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { reportCsv, runReport } from '$lib/server/finance/report-runner';
import { parseReportScope } from '$lib/server/finance/reports';
import { parseScPwdGroup } from '$lib/server/finance/sc-pwd-report';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	requireCap(locals.user, locals.role, 'reports:read');
	const hotel = locals.hotel!;
	const result = await runReport(hotel.id, params.slug, {
		timezone: hotel.timezone,
		date: url.searchParams.get('date') || undefined,
		from: url.searchParams.get('from') || undefined,
		to: url.searchParams.get('to') || undefined,
		scope: parseReportScope(url.searchParams.get('scope')),
		group: parseScPwdGroup(url.searchParams.get('group'))
	});
	if (!result) error(404, 'Unknown report');

	return new Response(reportCsv(result), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${params.slug}${result.scope === 'all' ? '' : `-${result.scope}`}-${new Date().toISOString().slice(0, 10)}.csv"`
		}
	});
};
