/**
 * Applies migrations to the CITY database only (reads .env.city).
 *   tsx scripts/city-migrate.ts main   -> main's ./drizzle (run after merging origin/main)
 *   tsx scripts/city-migrate.ts city   -> city-only ./drizzle-city
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

config({ path: '.env.city' });

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set in .env.city');
// Safety: this script must never run against the real hotel database.
if (!/\/[^/]*_city(\?|$)/.test(url)) throw new Error('Refusing to migrate: DATABASE_URL is not a *_city database');

const which = process.argv[2];
if (which !== 'main' && which !== 'city') throw new Error('usage: city-migrate.ts main|city');
const folder = which === 'main' ? './drizzle' : './drizzle-city';
if (!existsSync(`${folder}/meta/_journal.json`)) {
	console.log(`no migrations in ${folder} yet — nothing to do`);
	process.exit(0);
}

const client = postgres(url, { max: 1 });
await migrate(drizzle(client), {
	migrationsFolder: folder,
	migrationsTable: which === 'main' ? '__drizzle_migrations' : '__drizzle_city_migrations'
});
await client.end();
console.log(`${which} migrations applied`);
