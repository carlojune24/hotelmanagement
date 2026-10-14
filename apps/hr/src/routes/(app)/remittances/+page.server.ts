import { requireCap } from '$lib/server/auth/rbac';
import { getOrganization } from '$lib/server/establishments';
import { businessDateFor } from '$lib/server/time';
import { getOverview, getRemittanceSettings, periodSchema } from '$lib/server/hr/remittance';
import type { PageServerLoad } from './$types';

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
