import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { hotels, memberships, roles, rolePermissions } from '$lib/server/db/schema/index';
import type { MembershipRole, ResolvedRole } from '$lib/authz';

export type { MembershipRole, ResolvedRole };
export { RESERVED_PREFIXES, isValidSlug, slugError } from '$lib/slug';

export interface HotelContext {
	id: string;
	slug: string;
	name: string;
	city: string | null;
	timezone: string;
	currency: string;
	vatRateBps: number;
	checkInTime: string;
	checkOutTime: string;
	lateCheckoutFeePerHourCentavos: number;
	earlyCheckInFeePerHourCentavos: number;
	customDomain: string | null;
	orgRef: string;
	status: 'draft' | 'published' | 'archived';
	groupId: string | null;
	/** Free-form per-hotel config (branding, policies, defaults) — see `$lib/server/branding.ts` for the branding shape. */
	config: unknown;
}

/** Load a hotel by slug for request-time tenant resolution. Excludes soft-deleted. */
export async function loadHotelBySlug(slug: string): Promise<HotelContext | null> {
	const row = await db
		.select({
			id: hotels.id,
			slug: hotels.slug,
			name: hotels.name,
			city: hotels.city,
			timezone: hotels.timezone,
			currency: hotels.currency,
			vatRateBps: hotels.vatRateBps,
			checkInTime: hotels.checkInTime,
			checkOutTime: hotels.checkOutTime,
			lateCheckoutFeePerHourCentavos: hotels.lateCheckoutFeePerHourCentavos,
			earlyCheckInFeePerHourCentavos: hotels.earlyCheckInFeePerHourCentavos,
			customDomain: hotels.customDomain,
			orgRef: hotels.orgRef,
			status: hotels.status,
			groupId: hotels.groupId,
			config: hotels.config
		})
		.from(hotels)
		.where(and(eq(hotels.slug, slug), isNull(hotels.deletedAt)))
		.then((r) => r.at(0));
	return row ?? null;
}

/** Lean lookup for `hooks.server.ts`'s `reroute` hook — just the slug, not the full tenant
 *  context, since that's all a URL rewrite needs. Excludes soft-deleted. */
export async function loadHotelSlugByDomain(hostname: string): Promise<string | null> {
	const row = await db
		.select({ slug: hotels.slug })
		.from(hotels)
		.where(and(eq(hotels.customDomain, hostname), isNull(hotels.deletedAt)))
		.then((r) => r.at(0));
	return row?.slug ?? null;
}

/** Resolves the signed-in user's role at a hotel, including its DB-backed capability set.
 *  This is the one place per-request role resolution happens — `hooks.server.ts` calls it
 *  and assigns the result to `event.locals.role`. */
export async function getMembershipRole(userId: string, hotelId: string): Promise<ResolvedRole | null> {
	const membership = await db
		.select({ roleId: memberships.roleId })
		.from(memberships)
		.where(and(eq(memberships.userId, userId), eq(memberships.hotelId, hotelId)))
		.then((r) => r.at(0));
	if (!membership) return null;

	const role = await db
		.select({ id: roles.id, slug: roles.slug, name: roles.name, isProtected: roles.isProtected })
		.from(roles)
		.where(eq(roles.id, membership.roleId))
		.then((r) => r.at(0));
	if (!role) return null;

	const perms = await db
		.select({ capability: rolePermissions.capability })
		.from(rolePermissions)
		.where(eq(rolePermissions.roleId, role.id));

	return { ...role, capabilities: perms.map((p) => p.capability) };
}
