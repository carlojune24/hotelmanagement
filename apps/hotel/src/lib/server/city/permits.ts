import { asc, desc, eq, ne } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { hotels } from '$lib/server/db/schema/index';
import { cityPermits } from '$lib/server/db/schema/city';
import { todayManila } from '$lib/server/city/today';
import {
	countByStatus,
	currentPermits,
	permitStatus,
	daysUntil,
	type PermitStatus
} from '$lib/city/permits';

export type PermitOverviewRow = {
	hotelId: string;
	hotelName: string;
	hotelSlug: string;
	permitNumber: string | null;
	expiresOn: string | null;
	daysLeft: number | null;
	status: PermitStatus;
};

/** Every non-archived hotel with its current permit (the one expiring latest) and status as of today. */
export async function permitOverview() {
	const today = todayManila();
	const hotelRows = await db
		.select({ id: hotels.id, name: hotels.name, slug: hotels.slug })
		.from(hotels)
		.where(ne(hotels.status, 'archived'))
		.orderBy(asc(hotels.name));
	const permits = await db
		.select({
			id: cityPermits.id,
			hotelId: cityPermits.hotelId,
			permitNumber: cityPermits.permitNumber,
			expiresOn: cityPermits.expiresOn
		})
		.from(cityPermits);
	const current = currentPermits(permits);

	const rows: PermitOverviewRow[] = hotelRows.map((h) => {
		const p = current.get(h.id);
		return {
			hotelId: h.id,
			hotelName: h.name,
			hotelSlug: h.slug,
			permitNumber: p?.permitNumber ?? null,
			expiresOn: p?.expiresOn ?? null,
			daysLeft: p ? daysUntil(p.expiresOn, today) : null,
			status: permitStatus(p?.expiresOn, today)
		};
	});
	return { today, rows, counts: countByStatus(rows.map((r) => r.status)) };
}

export async function hotelPermits(hotelId: string) {
	const today = todayManila();
	const [hotel] = await db
		.select({ id: hotels.id, name: hotels.name, slug: hotels.slug })
		.from(hotels)
		.where(eq(hotels.id, hotelId));
	if (!hotel) return null;
	const history = await db
		.select()
		.from(cityPermits)
		.where(eq(cityPermits.hotelId, hotelId))
		.orderBy(desc(cityPermits.expiresOn), desc(cityPermits.createdAt));
	const current = history[0] ?? null; // latest expiry first
	return {
		today,
		hotel,
		history,
		current,
		status: permitStatus(current?.expiresOn, today),
		daysLeft: current ? daysUntil(current.expiresOn, today) : null
	};
}
