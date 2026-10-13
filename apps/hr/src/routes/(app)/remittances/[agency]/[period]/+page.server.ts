import { error, fail } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import { db } from '$lib/server/db/index';
import { establishments } from '$lib/server/db/schema/index';
import {
	AGENCY_LABEL,
	employerNoFor,
	RemittanceError,
	agencySchema,
	getSchedule,
	markRemitted,
	periodSchema,
	remitFormSchema,
	reopenRemittance
} from '$lib/server/hr/remittance';
import type { Actions, PageServerLoad } from './$types';

function parse(params: { agency: string; period: string }) {
	const agency = agencySchema.safeParse(params.agency);
	const period = periodSchema.safeParse(params.period);
	if (!agency.success || !period.success) error(404, 'Not found');
	return { agency: agency.data, period: period.data };
}

export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const { agency, period } = parse(params);
	const org = await getOrganization();
	const [s, ests] = await Promise.all([
		getSchedule(org.id, agency, period),
		db.select({ id: establishments.id, name: establishments.name }).from(establishments)
	]);
	const names = new Map(ests.map((e) => [e.id, e.name]));
	return {
		agency,
		label: AGENCY_LABEL[agency],
		period,
		schedule: s.schedule,
		byEstablishment: Object.entries(s.schedule.byEstablishment).map(([id, t]) => ({
			name: names.get(id) ?? 'Unknown',
			...t
		})),
		record: s.record,
		dueDate: s.dueDate,
		draftBatches: s.draftBatches,
		employerNo: employerNoFor(agency, s.settings)
	};
};

export const actions: Actions = {
	remit: async ({ request, locals, params }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const { agency, period } = parse(params);
		const parsed = remitFormSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0]!.message });
		try {
			const org = await getOrganization();
			const row = await markRemitted(org.id, agency, period, parsed.data, locals.user!.id);
			await writeAudit({
				actor: locals.user,
				action: 'remittance.remit',
				entityType: 'remittance',
				entityId: row.id,
				after: { agency, period, amountCentavos: row.amountCentavos, referenceNo: row.referenceNo }
			});
		} catch (e) {
			if (e instanceof RemittanceError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Marked as remitted.' };
	},

	reopen: async ({ locals, params }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const { agency, period } = parse(params);
		try {
			const org = await getOrganization();
			const row = await reopenRemittance(org.id, agency, period);
			await writeAudit({
				actor: locals.user,
				action: 'remittance.reopen',
				entityType: 'remittance',
				entityId: row.id,
				after: { agency, period }
			});
		} catch (e) {
			if (e instanceof RemittanceError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: 'Reopened.' };
	}
};
