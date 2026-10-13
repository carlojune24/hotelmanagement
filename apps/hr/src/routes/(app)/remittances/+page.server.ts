import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { getOrganization } from '$lib/server/establishments';
import { businessDateFor } from '$lib/server/time';
import { getOverview, getRemittanceSettings, periodSchema, saveRemittanceSettings } from '$lib/server/hr/remittance';
import type { Actions, PageServerLoad } from './$types';

const TZ = 'Asia/Manila';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.access, 'payroll:*');
	const today = businessDateFor(TZ);
	const asked = periodSchema.safeParse(url.searchParams.get('period'));
	const period = asked.success ? asked.data : today.slice(0, 7);
	const org = await getOrganization();
	const [overview, settings] = await Promise.all([getOverview(org.id, period, today), getRemittanceSettings(org.id)]);
	return { period, overview, settings };
};

const day = z.preprocess(
	(v) => (v === '' || v === null || v === undefined ? null : v),
	z.coerce.number().int().min(1).max(31).nullable()
);

export const actions: Actions = {
	saveSettings: async ({ request, locals }) => {
		requireCap(locals.user, locals.access, 'payroll:*');
		const parsed = z
			.object({
				sssNo: z.string().trim().max(40),
				philhealthNo: z.string().trim().max(40),
				pagibigNo: z.string().trim().max(40),
				dueSss: day,
				duePhilhealth: day,
				duePagibig: day,
				dueBir: day,
				dueSssLoan: day,
				duePagibigLoan: day
			})
			.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: 'Due days are 1–31 (or leave blank).' });
		const p = parsed.data;
		const org = await getOrganization();
		const dueDay = {
			sss: p.dueSss,
			philhealth: p.duePhilhealth,
			pagibig: p.duePagibig,
			bir: p.dueBir,
			sss_loan: p.dueSssLoan,
			pagibig_loan: p.duePagibigLoan
		};
		await saveRemittanceSettings(org.id, {
			employerIds: {
				sss: p.sssNo || undefined,
				philhealth: p.philhealthNo || undefined,
				pagibig: p.pagibigNo || undefined
			},
			dueDay
		});
		await writeAudit({
			actor: locals.user,
			action: 'remittance.settings',
			entityType: 'organization',
			entityId: org.id,
			after: { dueDay }
		});
		return { ok: 'Saved.' };
	}
};
