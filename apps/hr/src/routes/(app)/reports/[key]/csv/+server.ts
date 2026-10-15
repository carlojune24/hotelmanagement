import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import { toCsv, pesos } from '$lib/server/hr/csv';
import { buildReportDoc, isReportKey, parseParams } from '$lib/server/hr/report-docs';
import { businessDateFor } from '$lib/server/time';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	if (!isReportKey(params.key)) error(404, 'Not found');
	const org = await getOrganization();
	const p = await parseParams(org.id, url.searchParams, businessDateFor('Asia/Manila'));
	const doc = await buildReportDoc(params.key, org.id, p);

	// Each table in turn: its title, its header, its rows, then a blank line.
	const rows: Array<Array<string | number>> = [];
	for (const s of doc.sections) {
		rows.push([s.title], s.head);
		for (const r of s.rows) rows.push(r.map((v, i) => (s.moneyCols?.includes(i) && typeof v === 'number' ? pesos(v) : v)));
		rows.push([]);
	}
	await writeAudit({
		actor: locals.user,
		action: 'report.csv',
		entityType: 'report',
		entityId: params.key,
		after: p
	});
	return new Response(toCsv([doc.title, doc.period], rows), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${params.key}.csv"`
		}
	});
};
