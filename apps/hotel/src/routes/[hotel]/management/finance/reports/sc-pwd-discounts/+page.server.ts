import { requireCap } from '$lib/server/auth/rbac';
import { businessDateFor } from '$lib/server/finance/shared';
import { parseReportScope } from '$lib/server/finance/reports';
import { parseScPwdGroup, scPwdDiscountReport } from '$lib/server/finance/sc-pwd-report';
import type { PageServerLoad } from './$types';

const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The Senior / PWD discounts report has its own page (the claim register); its CSV still comes from
 *  the generic `[slug]/export`, which runs the same `scPwdDiscountReport`. */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'reports:read');
	const hotel = locals.hotel!;
	const today = businessDateFor(hotel.timezone);
	const monthStart = `${today.slice(0, 7)}-01`;
	const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from')! : monthStart;
	const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to')! : today;
	const scope = parseReportScope(url.searchParams.get('scope'));
	const group = parseScPwdGroup(url.searchParams.get('group'));
	return { today, monthStart, from, to, scope, group, report: await scPwdDiscountReport(hotel.id, from, to, scope, group) };
};
