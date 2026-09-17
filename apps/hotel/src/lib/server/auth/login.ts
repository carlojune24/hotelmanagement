import { asc, eq } from 'drizzle-orm';
import { db } from '../db/index';
import { hotels, memberships, users } from '../db/schema/index';
import { verifyPassword } from './password';

/** Looks up a user by email and verifies their password. Returns the full row on success,
 *  `null` on any failure (unknown email, no password set yet, disabled account, wrong
 *  password) — deliberately the same generic outcome for every failure mode, so a caller
 *  can't leak which reason it was. */
export async function verifyCredentials(email: string, password: string) {
	const user = await db
		.select()
		.from(users)
		.where(eq(users.email, email.toLowerCase()))
		.then((r) => r.at(0));

	const ok =
		user?.passwordHash && user.status === 'active'
			? await verifyPassword(user.passwordHash, password)
			: false;

	return ok ? user! : null;
}

/** The alphabetically-first (by hotel name) hotel a user has a membership at, or `null`.
 *  Used to route a signed-in user somewhere sensible when they have no explicit
 *  destination in mind — a real hotel picker is future work. */
export async function firstHotelSlugForUser(userId: string): Promise<string | null> {
	const [row] = await db
		.select({ slug: hotels.slug })
		.from(memberships)
		.innerJoin(hotels, eq(hotels.id, memberships.hotelId))
		.where(eq(memberships.userId, userId))
		.orderBy(asc(hotels.name))
		.limit(1);
	return row?.slug ?? null;
}
