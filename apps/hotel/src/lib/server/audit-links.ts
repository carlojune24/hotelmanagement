import type { AuditLog } from './db/schema/index';

const DINING_CODE = /^(DN|TB)-[A-Z0-9]{4}$/;

/**
 * Where an audit row's entity opens. A dining order, reservation, table check, receipt or cash
 * movement that belongs to a tracking number opens that number's trail; the rest keep their own
 * pages. `null` when there is nowhere sensible to go.
 */
export function auditRowHref(slug: string, e: Pick<AuditLog, 'entityType' | 'entityId' | 'refCode'>): string | null {
	const base = `/${slug}/management`;
	if (e.refCode && DINING_CODE.test(e.refCode)) return `${base}/trail/${e.refCode}`;
	if (!e.entityId) return null;
	// Older rows have no tracking number; the trail page turns the id into one.
	if (e.entityType === 'dining_order' || e.entityType === 'dining_reservation') return `${base}/trail/${e.entityId}`;
	if (e.entityType === 'booking') return `${base}/reservations/room/${e.entityId}`;
	if (e.entityType === 'hall_booking') return `${base}/reservations/hall/${e.entityId}`;
	if (e.entityType === 'cashier_shift') return `${base}/finance/shifts/${e.entityId}`;
	return null;
}
