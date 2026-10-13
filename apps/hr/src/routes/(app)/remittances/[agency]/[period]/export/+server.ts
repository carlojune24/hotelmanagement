import { error } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import { agencySchema, getSchedule, periodSchema, toCsv } from '$lib/server/hr/remittance';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const agency = agencySchema.safeParse(params.agency);
	const period = periodSchema.safeParse(params.period);
	if (!agency.success || !period.success) error(404, 'Not found');
	const org = await getOrganization();
	const { schedule } = await getSchedule(org.id, agency.data, period.data);
	await writeAudit({
		actor: locals.user,
		action: 'remittance.export',
		entityType: 'remittance',
		after: { agency: agency.data, period: period.data, people: schedule.rows.length }
	});
	return new Response(toCsv(schedule), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="remittance-${agency.data}-${period.data}.csv"`,
			'cache-control': 'no-store'
		}
	});
};
