import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// City-only tables. Main's `drizzle/` journal is never touched on this branch.
config({ path: '.env.city' });

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (copy apps/hotel/.env.city.example to .env.city)');

export default defineConfig({
	schema: './src/lib/server/db/schema/city/index.ts',
	out: './drizzle-city',
	dialect: 'postgresql',
	dbCredentials: { url },
	casing: 'snake_case',
	migrations: { table: '__drizzle_city_migrations' },
	verbose: true,
	strict: true
});
