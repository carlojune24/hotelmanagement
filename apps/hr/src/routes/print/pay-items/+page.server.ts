import { requireCap, requireUser } from '$lib/server/auth/rbac';
import { getOrganization } from '$lib/server/establishments';
import { listPayItems } from '$lib/server/hr/pay-items';
import type { PageServerLoad } from './$types';

/** The pay items list as filtered on the Pay items page (`?filter=&q=`). Main HR only. */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireUser(locals.user, url.pathname + url.search);
	requireCap(locals.user, locals.access, 'payroll:*');
	const org = await getOrganization();
	const filter = url.searchParams.get('filter') ?? 'all';
	const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
	const items = (await listPayItems(org.id)).filter((i) => {
		if (q && !`${i.employeeName} ${i.employeeNo} ${i.label}`.toLowerCase().includes(q)) return false;
		if (filter === 'voided') return i.status === 'voided';
		if (filter === 'archived') return i.status === 'archived';
		if (i.status === 'voided' || i.status === 'archived') return false;
		return filter === 'all' || i.kind === filter;
	});
	const total = (kind: 'earning' | 'deduction') =>
		items.filter((i) => i.kind === kind).reduce((a, i) => a + i.amountCentavos, 0);
	return {
		company: org.name,
		items,
		earnings: total('earning'),
		deductions: total('deduction'),
		title: { all: 'Pay items', earning: 'Pay items: earnings', deduction: 'Pay items: deductions', voided: 'Pay items: voided', archived: 'Pay items: archived' }[
			filter as 'all' | 'earning' | 'deduction' | 'voided' | 'archived'
		] ?? 'Pay items',
		query: q
	};
};
