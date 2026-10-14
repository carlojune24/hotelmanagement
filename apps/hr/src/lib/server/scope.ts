import { canAt, type Access } from '$lib/authz';
import { listEstablishments } from './establishments';

export interface Scope {
	establishments: Array<{ slug: string; name: string }>;
	current: { slug: string; name: string };
	items: Array<{ seg: string; label: string }>;
}

const ITEMS: Array<{ seg: string; label: string; cap: string | null }> = [
	{ seg: 'dashboard', label: 'Dashboard', cap: null },
	{ seg: 'employees', label: 'Employees', cap: 'employee:read' },
	{ seg: 'schedule', label: 'Schedule', cap: 'schedule:*' },
	{ seg: 'dtr', label: 'DTR', cap: 'dtr:*' },
	{ seg: 'leave', label: 'Leave', cap: 'leave:file' },
{ seg: 'overtime', label: 'Overtime', cap: 'overtime:file' },
	{ seg: 'memos', label: 'Memos', cap: 'memo:propose' },
	{ seg: 'payslips', label: 'Payslips', cap: 'payslip:read' },
	{ seg: 'guide', label: 'Guide', cap: 'dtr:*' },
	{ seg: 'settings', label: 'Settings', cap: 'schedule:*' }
];

/** True for someone whose access is only per-establishment (a manager or clerk), never org-wide. */
export const isEstablishmentScoped = (user: { isSystemAdmin: boolean }, access: Access) =>
	!user.isSystemAdmin && access.orgCaps.length === 0 && Object.keys(access.establishments).length > 0;

/**
 * The sidebar for an establishment-scoped user: their establishments (for the switcher) and the menu of
 * the one they are in. Org-wide users (Main HR, owner) get null and keep the company menu.
 */
export async function establishmentScope(
	user: { isSystemAdmin: boolean },
	access: Access,
	currentSlug: string | null
): Promise<Scope | null> {
	if (!isEstablishmentScoped(user, access)) return null;
	const rows = (await listEstablishments(Object.keys(access.establishments))).filter((e) => e.status === 'active');
	if (rows.length === 0) return null;
	const current = rows.find((e) => e.slug === currentSlug) ?? rows[0]!;
	return {
		establishments: rows.map((e) => ({ slug: e.slug, name: e.name })),
		current: { slug: current.slug, name: current.name },
		items: ITEMS.filter((i) => i.cap === null || canAt(access, i.cap, current.id)).map(({ seg, label }) => ({ seg, label }))
	};
}
