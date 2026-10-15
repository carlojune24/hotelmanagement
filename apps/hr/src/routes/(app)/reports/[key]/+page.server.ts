import { error } from '@sveltejs/kit';
import { getOrganization, listEstablishments } from '$lib/server/establishments';
import { INTERNAL_REPORTS, buildReportDoc, isReportKey, parseParams } from '$lib/server/hr/report-docs';
import { businessDateFor } from '$lib/server/time';
import type { PageServerLoad } from './$types';

/** The internal reports (headcount, payroll summary, attendance, turnover). Main HR only via the layout. */
export const load: PageServerLoad = async ({ params, url }) => {
	if (!isReportKey(params.key)) error(404, 'Not found');
	const org = await getOrganization();
	const p = await parseParams(org.id, url.searchParams, businessDateFor('Asia/Manila'));
	const [doc, ests] = await Promise.all([buildReportDoc(params.key, org.id, p), listEstablishments()]);
	return {
		doc,
		p,
		filter: INTERNAL_REPORTS.find((r) => r.key === params.key)!.filter,
		establishments: ests.map((e) => ({ id: e.id, name: e.name }))
	};
};
