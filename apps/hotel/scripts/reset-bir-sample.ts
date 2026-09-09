/** Wipe issued sample documents for the demo hotel and reset its series counters,
 *  so a re-render picks up the current formatting. `pnpm tsx scripts/reset-bir-sample.ts`. */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema/index';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: 'snake_case' });
const { hotels, documents, documentSeries, zReadings } = schema;

const slug = process.env.HOTEL_SLUG ?? 'hotel1';
const [hotel] = await db.select().from(hotels).where(eq(hotels.slug, slug)).limit(1);
if (!hotel) throw new Error(`hotel "${slug}" not found`);

const del = await db.delete(documents).where(eq(documents.hotelId, hotel.id)).returning({ id: documents.id });
const delZ = await db.delete(zReadings).where(eq(zReadings.hotelId, hotel.id)).returning({ id: zReadings.id });
const upd = await db
	.update(documentSeries)
	.set({ nextSerial: 1, status: 'active', updatedAt: new Date() })
	.where(eq(documentSeries.hotelId, hotel.id))
	.returning({ id: documentSeries.id, type: documentSeries.type });
console.log(
	`deleted ${del.length} documents, ${delZ.length} z-readings; reset ${upd.length} series to nextSerial=1`,
	upd
);
await client.end();
