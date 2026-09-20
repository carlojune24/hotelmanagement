import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import * as schema from './schema/index';

// NOTE: intentionally uses process.env instead of $env/dynamic/private so this
// module also works under tsx scripts (db:seed, db:migrate helpers import it
// transitively via auth/roles -> audit). SvelteKit/Vite populates process.env
// from .env on the server; tsx scripts load it via `import 'dotenv/config'`.
// const url = process.env.DATABASE_URL;
const url = env.DATABASE_URL;
// const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// One shared pool per server process. postgres-js is safe to reuse.
const client = postgres(url, { max: 10 });

export const db = drizzle(client, { schema, casing: 'snake_case' });
export type DB = typeof db;
export { schema };
