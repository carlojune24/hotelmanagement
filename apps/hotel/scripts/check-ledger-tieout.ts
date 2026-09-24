/**
 * Read-only check: does every cash account's stored balance agree with the double-entry
 * ledger? Prints one line per account and the plain-English reason for any mismatch, and
 * exits 1 if any account is off — so it can gate a deploy or run from CI.
 *
 *   pnpm ledger:check
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema/index';
import { cashLedgerTieOut } from '../src/lib/server/finance/tieout';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: 'snake_case' });

const peso = (c: number) =>
	`${c < 0 ? '-' : ''}₱${(Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
	let bad = 0;
	for (const h of await db.select({ id: schema.hotels.id, slug: schema.hotels.slug }).from(schema.hotels)) {
		const rows = await cashLedgerTieOut(db, h.id);
		console.log(`\n${h.slug} — ${rows.length} cash account(s)`);
		for (const r of rows) {
			const tag = r.ok ? 'OK  ' : 'FAIL';
			console.log(
				`  ${tag} ${r.name.padEnd(22)} stored ${peso(r.storedCentavos).padStart(14)}  ledger ${peso(r.ledgerCentavos).padStart(14)}` +
					(r.ok ? '' : `  diff ${peso(r.differenceCentavos)}`)
			);
			for (const reason of r.reasons) console.log(`         - ${reason}`);
			if (!r.ok) bad++;
		}
	}
	console.log(bad === 0 ? '\nAll cash accounts tie out to the ledger.' : `\n${bad} account(s) do not tie out.`);
	await client.end();
	process.exit(bad === 0 ? 0 : 1);
}

main().catch(async (e) => {
	console.error(e);
	await client.end();
	process.exit(2);
});
