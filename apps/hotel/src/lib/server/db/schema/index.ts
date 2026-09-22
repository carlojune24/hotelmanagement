/**
 * Aggregated Drizzle schema. Domain files are added here as each phase lands.
 * App-only tables live in this folder; canonical HR/finance shapes come from
 * @mm/hr-core and @mm/finance-core (wired in Phases 3–5).
 */
export * from './auth';
export * from './roles';
export * from './hotels';
export * from './audit';
export * from './inventory';
export * from './amenities';
export * from './function-halls';
export * from './dining';
export * from './orders';
export * from './bookings';
export * from './room-assignments';
export * from './housekeeping';
export * from './reviews';
export * from './folio';
export * from './finance';
export * from './ledger';
export * from './api-keys';
export * from './jobs';
export * from './standalone-sales';
export * from './documents';
export * from './email-log';
export * from './guest-messages';
export * from './hr';
