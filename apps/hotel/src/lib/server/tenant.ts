import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { hotels, memberships } from '$lib/server/db/schema/index';
import type { MembershipRole } from '$lib/authz';

export type { MembershipRole };
export { RESERVED_PREFIXES, isValidSlug, slugError } from '$lib/slug';

export interface HotelContext {
	id: string;
	slug: string;
	name: string;
	timezone: string;
	currency: string;
	vatRateBps: number;
	orgRef: string;
	status: 'draft' | 'published' | 'archived';
	groupId: string | null;
}

/** Load a hotel by slug for request-time tenant resolution. Excludes soft-deleted. */
export async function loadHotelBySlug(slug: string): Promise<HotelContext | null> {
	const row = await db
		.select({
			id: hotels.id,
			slug: hotels.slug,
			name: hotels.name,
			timezone: hotels.timezone,
			currency: hotels.currency,
			vatRateBps: hotels.vatRateBps,
			orgRef: hotels.orgRef,
			status: hotels.status,
			groupId: hotels.groupId
		})
		.from(hotels)
		.where(and(eq(hotels.slug, slug), isNull(hotels.deletedAt)))
		.then((r) => r.at(0));
	return row ?? null;
}

export async function getMembershipRole(
	userId: string,
	hotelId: string
): Promise<MembershipRole | null> {
	const row = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(and(eq(memberships.userId, userId), eq(memberships.hotelId, hotelId)))
		.then((r) => r.at(0));
	return (row?.role as MembershipRole | undefined) ?? null;
}
