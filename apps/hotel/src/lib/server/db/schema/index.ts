/**
 * Aggregated Drizzle schema. Domain files are added here as each phase lands.
 * App-only tables live in this folder; canonical HR/finance shapes come from
 * @mm/hr-core and @mm/finance-core (wired in Phases 3–5).
 */
export * from './auth';
export * from './hotels';
export * from './audit';
