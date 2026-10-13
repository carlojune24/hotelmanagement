import { requireCap } from '$lib/server/auth/rbac';
import { releasedPayslipsFor } from '$lib/server/hr/payroll';
import type { PageServerLoad } from './$types';

/** What a manager sees: payslips Main HR has *released* for people whose home is this establishment. */
export const load: PageServerLoad = async ({ locals }) => {
	const est = locals.establishment!;
	requireCap(locals.user, locals.access, 'payslip:read', est.id);
	const rows = await releasedPayslipsFor(est.id);
	// Group by cutoff so the page reads as "this payday: these people".
	const groups = new Map<string, { cutoffStart: string; cutoffEnd: string; payDate: string; slips: typeof rows }>();
	for (const r of rows) {
		const key = `${r.cutoffStart}|${r.cutoffEnd}`;
		const g = groups.get(key) ?? { cutoffStart: r.cutoffStart, cutoffEnd: r.cutoffEnd, payDate: r.payDate, slips: [] };
		g.slips.push(r);
		groups.set(key, g);
	}
	return { groups: [...groups.values()] };
};
