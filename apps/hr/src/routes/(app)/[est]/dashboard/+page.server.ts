import { error } from '@sveltejs/kit';
import { getOrganization } from '$lib/server/establishments';
import { announcementsFor } from '$lib/server/hr/announcements';
import { getDashboard } from '$lib/server/hr/dashboard';
import { businessDateFor } from '$lib/server/time';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const est = locals.establishment;
	if (!est) error(404, 'Not found');
	const today = businessDateFor(est.timezone);
	const org = await getOrganization();
	const [dashboard, notices] = await Promise.all([
		getDashboard(est.id, est.slug, today, est.timezone),
		announcementsFor(org.id, est.id, today)
	]);
	return {
		dashboard,
		announcements: notices.map((n) => ({
			id: n.id,
			title: n.title,
			body: n.body,
			pinned: n.pinned,
			postedOn: n.createdAt.toISOString().slice(0, 10),
			expiresOn: n.expiresOn
		}))
	};
};
