import { error } from '@sveltejs/kit';
import { requireCap, requireUser } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import { AGENCY_LABEL, agencySchema, employerNoFor, getSchedule, periodSchema } from '$lib/server/hr/remittance';
import type { PageServerLoad } from './$types';

/** The printable schedule for one agency and month — Main HR only, and every print is audited. */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireUser(locals.user, url.pathname);
	requireCap(locals.user, locals.access, 'payroll:*');
	const agency = agencySchema.safeParse(params.agency);
	const period = periodSchema.safeParse(params.period);
	if (!agency.success || !period.success) error(404, 'Not found');

	const org = await getOrganization();
	const s = await getSchedule(org.id, agency.data, period.data);
	await writeAudit({
		actor: locals.user,
		action: 'remittance.print',
		entityType: 'remittance',
		after: { agency: agency.data, period: period.data, people: s.schedule.rows.length }
	});
	return {
		agency: agency.data,
		label: AGENCY_LABEL[agency.data],
		period: period.data,
		employer: s.settings.employer,
		employerNo: employerNoFor(agency.data, s.settings),
		schedule: s.schedule,
		record: s.record,
		draftBatches: s.draftBatches
	};
};
