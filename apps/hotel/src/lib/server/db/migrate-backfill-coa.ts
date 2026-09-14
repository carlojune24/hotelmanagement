/**
 * One-off backfill: seeds the chart of accounts (and, for a hotel with no Finance
 * setup at all yet, the rest of Finance defaults too) for every hotel that already
 * exists. New hotels get this automatically from `finance/seed-defaults.ts`'s
 * `seedFinanceDefaults` — this script is only for hotels created before the ledger
 * feature shipped. Idempotent: `seedChartOfAccounts`/`seedFinanceDefaults` both skip
 * a hotel that's already seeded. Run once via
 * `tsx src/lib/server/db/migrate-backfill-coa.ts`.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from './schema/index';
import { hotels, cashAccounts } from './schema/index';
import { seedFinanceDefaults, seedChartOfAccounts } from '../finance/seed-defaults';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: 'snake_case' });

async function main() {
	const allHotels = await db.select({ id: hotels.id, slug: hotels.slug }).from(hotels);
	for (const h of allHotels) {
		const [existingCashAccounts] = await db
			.select({ id: cashAccounts.id })
			.from(cashAccounts)
			.where(eq(cashAccounts.hotelId, h.id))
			.limit(1);

		if (!existingCashAccounts) {
			await seedFinanceDefaults(db, h.id);
			console.log(`${h.slug}: seeded full Finance defaults (incl. chart of accounts)`);
		} else {
			await seedChartOfAccounts(db, h.id);
			console.log(`${h.slug}: backfilled chart of accounts`);
		}
	}
	console.log(`Done. Checked ${allHotels.length} hotel(s).`);
	await client.end();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
