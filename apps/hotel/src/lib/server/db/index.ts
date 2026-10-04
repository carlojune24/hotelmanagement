import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import 'dotenv/config';
import * as schema from './schema/index';
import { env } from '$env/dynamic/private';

// NOTE: intentionally uses process.env instead of $env/dynamic/private so this
// module also works under tsx scripts (db:seed, db:migrate helpers import it
// transitively via auth/roles -> audit). `$env/*` only resolves inside SvelteKit/Vite,
// so importing it here breaks `pnpm db:seed`. tsx scripts load .env via dotenv above.
// const url = process.env.DATABASE_URL;
const url = env.DATABASE_URL;

if (!url) throw new Error('DATABASE_URL is not set');

// One shared pool per server process. postgres-js is safe to reuse.
const client = postgres(url, { max: 10 });

export const db = drizzle(client, { schema, casing: 'snake_case' });
export type DB = typeof db;
export { schema };
