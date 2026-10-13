import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { users } from '../db/schema/index';
import { verifyPassword } from './password';

/** Looks up a user by email and verifies their password. Returns the row on success, `null`
 *  on any failure — the same generic outcome for every failure mode so a caller can't leak why. */
export async function verifyCredentials(email: string, password: string) {
	const user = await db
		.select()
		.from(users)
		.where(eq(users.email, email.trim().toLowerCase()))
		.then((r) => r.at(0));

	const ok =
		user?.passwordHash && user.status === 'active'
			? await verifyPassword(user.passwordHash, password)
			: false;

	return ok ? user! : null;
}
