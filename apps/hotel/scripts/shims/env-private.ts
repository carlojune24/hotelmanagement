/**
 * Stand-in for SvelteKit's `$env/dynamic/private` when app code is run from a tsx script
 * (see scripts/tsconfig.json). Reads the process environment, which the script loads from .env.city.
 */
export const env = process.env as Record<string, string | undefined>;
