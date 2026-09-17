import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db/index';
import { ratePlans } from './db/schema/index';

/**
 * Every distinct inclusion string already used across this hotel's rate plans,
 * case-insensitively deduped (first-seen casing wins) and sorted — the
 * suggestion list the inclusions tag-input autocompletes against, so the same
 * inclusion doesn't end up spelled several different ways across plans.
 */
export async function listDistinctInclusions(hotelId: string): Promise<string[]> {
	const rows = await db
		.select({ inclusions: ratePlans.inclusions })
		.from(ratePlans)
		.where(and(eq(ratePlans.hotelId, hotelId), isNull(ratePlans.deletedAt)));

	const seen = new Map<string, string>();
	for (const row of rows) {
		for (const item of row.inclusions) {
			const key = item.toLowerCase();
			if (!seen.has(key)) seen.set(key, item);
		}
	}
	return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
