import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { establishmentMemberships, orgMemberships } from '../db/schema/index';
import { ROLE_CAPS, type Access, type Role } from '$lib/authz';

const caps = (role: string): string[] => ROLE_CAPS[role as Role] ?? [];

/** Resolves everything a user may do: their org-wide role plus any per-establishment roles. */
export async function loadAccess(userId: string): Promise<Access> {
	const [org, ests] = await Promise.all([
		db
			.select()
			.from(orgMemberships)
			.where(eq(orgMemberships.userId, userId))
			.then((r) => r.at(0)),
		db.select().from(establishmentMemberships).where(eq(establishmentMemberships.userId, userId))
	]);
	return {
		orgCaps: org ? caps(org.role) : [],
		establishments: Object.fromEntries(ests.map((e) => [e.establishmentId, caps(e.role)]))
	};
}
