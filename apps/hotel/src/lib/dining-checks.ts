/** Pure rules for a table's check. No database, so the floor plan and Orders board can use the
 *  same maths the server enforces when it settles and closes a table. */

export interface CheckOrderLite {
	status: string;
	paymentStatus: string;
	totalCentavos: number;
}

/**
 * Where a table stands:
 * - `ordering`: food still being made or taken to the table, or an order awaiting staff.
 * - `needs_payment`: everything is served (or the guest asked for the bill) and some of it is unpaid.
 * - `ready_to_clear`: all served and paid, so the table can be closed and freed.
 */
export type CheckStage = 'ordering' | 'needs_payment' | 'ready_to_clear';

export interface CheckSummary {
	/** Total of the live (not cancelled, not awaiting staff) orders. */
	totalCentavos: number;
	unpaidCentavos: number;
	unpaidCount: number;
	/** Table-QR orders a waiter has not accepted yet. */
	awaitingAcceptance: number;
	/** Orders not yet served: new, accepted, preparing or ready. */
	inProgress: number;
	/** Orders the kitchen has finished that are waiting to be taken to the table. */
	readyCount: number;
	/** Orders the kitchen is still working on (new, accepted or preparing). */
	cookingCount: number;
	liveCount: number;
	stage: CheckStage;
}

const IN_PROGRESS = new Set(['new', 'accepted', 'preparing', 'ready']);

export function summarizeCheck(orders: CheckOrderLite[], billRequested: boolean): CheckSummary {
	const live = orders.filter((o) => o.status !== 'cancelled' && o.status !== 'pending_acceptance');
	const awaitingAcceptance = orders.filter((o) => o.status === 'pending_acceptance').length;
	const inProgress = live.filter((o) => IN_PROGRESS.has(o.status)).length;
	const readyCount = live.filter((o) => o.status === 'ready').length;
	const unpaid = live.filter((o) => o.paymentStatus === 'unpaid');
	const unpaidCount = unpaid.length;

	let stage: CheckStage;
	if (awaitingAcceptance === 0 && inProgress === 0 && unpaidCount === 0) stage = 'ready_to_clear';
	else if (unpaidCount > 0 && (billRequested || (inProgress === 0 && awaitingAcceptance === 0))) stage = 'needs_payment';
	else stage = 'ordering';

	return {
		totalCentavos: live.reduce((s, o) => s + o.totalCentavos, 0),
		unpaidCentavos: unpaid.reduce((s, o) => s + o.totalCentavos, 0),
		unpaidCount,
		awaitingAcceptance,
		inProgress,
		readyCount,
		cookingCount: inProgress - readyCount,
		liveCount: live.length,
		stage
	};
}

export const checkStage = (summary: CheckSummary): CheckStage => summary.stage;

export const CHECK_STAGE_LABEL: Record<CheckStage, string> = {
	ordering: 'Occupied',
	needs_payment: 'Needs payment',
	ready_to_clear: 'Ready to clear'
};
