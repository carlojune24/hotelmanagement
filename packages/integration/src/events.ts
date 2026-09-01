/**
 * @mm/integration/events — the outbox event envelope and the catalogue of event
 * types MM apps publish for push consolidation.
 *
 * Producers write these rows to an `outbox` table inside the same transaction as
 * the state change; a dispatcher delivers them at-least-once. Consumers dedupe on
 * `id` and treat delivery as an idempotent upsert of the referenced resource.
 */
import { z } from 'zod';
import { instant, sourceApp, uuid, MM_STANDARD_VERSION } from './primitives';

export const eventType = z.enum([
	'employee.updated',
	'payroll_run.posted',
	'journal_entry.posted',
	'cash_movement.recorded'
]);
export type EventType = z.infer<typeof eventType>;

export const eventEnvelope = z.object({
	id: uuid,
	type: eventType,
	occurred_at: instant,
	source_app: sourceApp,
	standard_version: z.literal(MM_STANDARD_VERSION),
	/**
	 * The changed resource, in the same shape the matching read endpoint returns.
	 * Typed per event by the consuming app against the resource schema.
	 */
	data: z.unknown()
});
export type EventEnvelope = z.infer<typeof eventEnvelope>;
