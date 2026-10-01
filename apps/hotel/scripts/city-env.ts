/**
 * Import this FIRST in a city script: loads .env.city and refuses to continue unless DATABASE_URL points at a
 * `*_city` database. ES imports run in order, so this runs before any module that reads DATABASE_URL.
 */
import { config } from 'dotenv';

config({ path: '.env.city' });

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set in .env.city');
if (!/\/[^/]*_city(\?|$)/.test(url)) throw new Error('Refusing to run: DATABASE_URL is not a *_city database');
