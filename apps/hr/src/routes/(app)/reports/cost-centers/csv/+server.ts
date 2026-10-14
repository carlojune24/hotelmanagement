import { requireCap } from '$lib/server/auth/rbac';
import { getOrganization } from '$lib/server/establishments';
import { costCenterReport, costReportCsv } from '$lib/server/hr/reports';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const month = url.searchParams.get('month') ?? '';
	if (!/^\d{4}-\d{2}$/.test(month)) return new Response('Pick a month.', { status: 400 });
	const org = await getOrganization();
	const report = await costCenterReport(org.id, {
		month,
		establishmentId: url.searchParams.get('est') || null,
		includeDrafts: url.searchParams.get('drafts') === '1'
	});
	return new Response(costReportCsv(report), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="cost-by-cost-center-${month}.csv"`
		}
	});
};
