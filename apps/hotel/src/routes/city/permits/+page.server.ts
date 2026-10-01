import { requirePlatformAdmin } from '$lib/server/auth/rbac';
import { permitOverview } from '$lib/server/city/permits';
import { isPermitStatus } from '$lib/city/permits';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requirePlatformAdmin(locals.user);
	const raw = url.searchParams.get('status');
	const status = isPermitStatus(raw) ? raw : null;
	const { today, rows, counts } = await permitOverview();

	// Most urgent first: expired, then soonest expiry, then hotels with no permit, then valid by date.
	const rank = (r: (typeof rows)[number]) =>
		r.status === 'expired' ? 0 : r.status === 'expiring' ? 1 : r.status === 'none' ? 2 : 3;
	const sorted = [...rows].sort(
		(a, b) =>
			rank(a) - rank(b) ||
			(a.expiresOn ?? '').localeCompare(b.expiresOn ?? '') ||
			a.hotelName.localeCompare(b.hotelName)
	);
	return {
		today,
		status,
		counts,
		total: rows.length,
		rows: status ? sorted.filter((r) => r.status === status) : sorted
	};
};
