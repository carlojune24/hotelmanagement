import { db } from '$lib/server/db/index';
import { organizations } from '$lib/server/db/schema/index';
import { mintRef } from '$lib/server/ids';

/** The organization the throwaway test establishments hang off: the existing one, or a
 *  placeholder when the DB has none (a real database always has one from `db:seed`). */
export async function testOrgId(): Promise<string> {
	const existing = await db.select({ id: organizations.id }).from(organizations).limit(1);
	if (existing[0]) return existing[0].id;
	const [org] = await db
		.insert(organizations)
		.values({ orgRef: mintRef('org'), name: 'HR test organization' })
		.returning({ id: organizations.id });
	return org!.id;
}
