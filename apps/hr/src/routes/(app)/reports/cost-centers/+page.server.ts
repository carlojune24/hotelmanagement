import { getOrganization, listEstablishments } from '$lib/server/establishments';
import { costCenterReport, monthsWithPayroll } from '$lib/server/hr/reports';
import { businessDateFor } from '$lib/server/time';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const org = await getOrganization();
	const months = await monthsWithPayroll(org.id);
	const asked = url.searchParams.get('month') ?? '';
	const month = /^\d{4}-\d{2}$/.test(asked) ? asked : (months[0] ?? businessDateFor('Asia/Manila').slice(0, 7));
	const est = url.searchParams.get('est') ?? '';
	const includeDrafts = url.searchParams.get('drafts') === '1';
	const [report, ests] = await Promise.all([
		costCenterReport(org.id, { month, establishmentId: est || null, includeDrafts }),
		listEstablishments()
	]);
	return {
		report,
		month,
		est,
		includeDrafts,
		establishments: ests.map((e) => ({ id: e.id, name: e.name })),
		query: url.search
	};
};
