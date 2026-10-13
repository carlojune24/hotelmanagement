import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';
import { env } from '$env/dynamic/private';

const url = env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// One shared pool per server process. postgres-js is safe to reuse.
const client = postgres(url, { max: 10 });

export const db = drizzle(client, { schema, casing: 'snake_case' });
export type DB = typeof db;
