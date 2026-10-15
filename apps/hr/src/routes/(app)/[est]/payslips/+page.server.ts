import { requireCap } from '$lib/server/auth/rbac';
import { releasedPayslipsFor } from '$lib/server/hr/payroll';
import type { PageServerLoad } from './$types';

/** What a manager sees: payslips Main HR has *released* for people whose home is this establishment. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const est = locals.establishment!;
	requireCap(locals.user, locals.access, 'payslip:read', est.id);
	const all = await releasedPayslipsFor(est.id);
	// A run filter and a year/month filter never combine; a run wins. Year/month match the pay date.
	const run = url.searchParams.get('run') ?? '';
	const year = url.searchParams.get('year') ?? '';
	const month = url.searchParams.get('month') ?? '';
	const rows = all.filter((r) =>
		run ? r.runId === run : (!year || r.payDate.startsWith(year)) && (!month || r.payDate.slice(5, 7) === month)
	);
	const runs = [...new Map(all.map((r) => [r.runId, r])).values()].map((r) => ({
		id: r.runId,
		label: `${r.cutoffStart} → ${r.cutoffEnd} · pay ${r.payDate}`
	}));
	const years = [...new Set(all.map((r) => r.payDate.slice(0, 4)))];
	// Group by cutoff so the page reads as "this payday: these people".
	const groups = new Map<string, { cutoffStart: string; cutoffEnd: string; payDate: string; slips: typeof rows }>();
	for (const r of rows) {
		const key = `${r.cutoffStart}|${r.cutoffEnd}`;
		const g = groups.get(key) ?? { cutoffStart: r.cutoffStart, cutoffEnd: r.cutoffEnd, payDate: r.payDate, slips: [] };
		g.slips.push(r);
		groups.set(key, g);
	}
	return { groups: [...groups.values()], runs, years, filter: { run, year, month }, filtered: all.length > 0 };
};
