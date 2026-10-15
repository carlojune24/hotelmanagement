import { error } from '@sveltejs/kit';
import { requireCap, requireUser } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization, listEstablishments } from '$lib/server/establishments';
import { buildReportDoc, isReportKey, parseParams } from '$lib/server/hr/report-docs';
import { businessDateFor } from '$lib/server/time';
import type { PageServerLoad } from './$types';

/** An internal report as filtered on the Reports page. Main HR only; audited. */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireUser(locals.user, url.pathname + url.search);
	requireCap(locals.user, locals.access, 'payroll:*');
	if (!isReportKey(params.key)) error(404, 'Not found');
	const org = await getOrganization();
	const p = await parseParams(org.id, url.searchParams, businessDateFor('Asia/Manila'));
	const [doc, ests] = await Promise.all([buildReportDoc(params.key, org.id, p), listEstablishments()]);
	await writeAudit({ actor: locals.user, action: 'report.print', entityType: 'report', entityId: params.key, after: p });
	return {
		company: org.name,
		doc,
		scope: p.est ? (ests.find((e) => e.id === p.est)?.name ?? 'One establishment') : 'All establishments'
	};
};
