import { error } from '@sveltejs/kit';
import { requireCap, requireUser } from '$lib/server/auth/rbac';
import { getOrganization, listEstablishments } from '$lib/server/establishments';
import { costCenterReport } from '$lib/server/hr/reports';
import type { PageServerLoad } from './$types';

/** The cost-by-cost-center report as filtered on the Reports page. Main HR only. */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireUser(locals.user, url.pathname + url.search);
	requireCap(locals.user, locals.access, 'payroll:*');
	const month = url.searchParams.get('month') ?? '';
	if (!/^\d{4}-\d{2}$/.test(month)) error(400, 'Pick a month.');
	const est = url.searchParams.get('est') || null;
	const org = await getOrganization();
	const [report, ests] = await Promise.all([
		costCenterReport(org.id, { month, establishmentId: est, includeDrafts: url.searchParams.get('drafts') === '1' }),
		listEstablishments()
	]);
	return {
		company: org.name,
		report,
		scope: est ? (ests.find((e) => e.id === est)?.name ?? 'One establishment') : 'All establishments',
		includeDrafts: url.searchParams.get('drafts') === '1'
	};
};
