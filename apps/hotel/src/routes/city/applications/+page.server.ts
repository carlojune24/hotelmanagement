import { count, desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { cityApplications } from '$lib/server/db/schema/city';
import { APPLICATION_STATUSES, isApplicationStatus } from '$lib/city/applications';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const raw = url.searchParams.get('status');
	const status = isApplicationStatus(raw) ? raw : null;

	const countRows = await db
		.select({ status: cityApplications.status, n: count() })
		.from(cityApplications)
		.groupBy(cityApplications.status);
	const counts = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0])) as Record<
		(typeof APPLICATION_STATUSES)[number],
		number
	>;
	for (const r of countRows) counts[r.status] = r.n;

	const rows = await db
		.select({
			id: cityApplications.id,
			ref: cityApplications.ref,
			hotelName: cityApplications.hotelName,
			city: cityApplications.city,
			contactName: cityApplications.contactName,
			permitNumber: cityApplications.permitNumber,
			permitExpiresOn: cityApplications.permitExpiresOn,
			status: cityApplications.status,
			createdAt: cityApplications.createdAt
		})
		.from(cityApplications)
		.where(status ? eq(cityApplications.status, status) : undefined)
		.orderBy(desc(cityApplications.createdAt))
		.limit(200);

	return { status, counts, total: Object.values(counts).reduce((a, b) => a + b, 0), rows };
};
