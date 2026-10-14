import { and, eq } from 'drizzle-orm';

/**
 * Test fixture: the id of a hotel's prep station, creating it on first use. A dish must belong to a
 * station, so any test that inserts menu items needs one. The db is imported lazily so a test file
 * can import this at the top and still be skipped cleanly when no database is configured.
 */
export async function stationIdFor(hotelId: string, name = 'Kitchen'): Promise<string> {
	const { db } = await import('./db/index');
	const { diningStations } = await import('./db/schema/index');
	await db.insert(diningStations).values({ hotelId, name }).onConflictDoNothing();
	const [row] = await db
		.select({ id: diningStations.id })
		.from(diningStations)
		.where(and(eq(diningStations.hotelId, hotelId), eq(diningStations.name, name)))
		.limit(1);
	return row!.id;
}
