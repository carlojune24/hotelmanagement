/** Pure model for the Floor: what each table is doing right now, how urgent it is, and how the
 *  status bar filters them. No database and safe in the browser. */
import type { CheckStage } from './dining-checks';

export type TableStage = 'free' | 'reserved' | 'seated' | 'occupied' | 'needs_payment' | 'ready_to_clear';

export const STAGE_LABEL: Record<TableStage, string> = {
	free: 'Free',
	reserved: 'Reserved',
	seated: 'Seated',
	occupied: 'Occupied',
	needs_payment: 'Needs payment',
	ready_to_clear: 'Ready to clear'
};

export interface FloorCheck {
	stage: CheckStage;
	openedAt: Date | string;
	billRequestedAt: Date | string | null;
	/** Orders the kitchen has finished that nobody has taken to the table yet. */
	readyCount: number;
	awaitingAcceptance: number;
}

export interface FloorReservation {
	id: string;
	status: string;
	startsAt: Date | string;
	endsAt: Date | string;
	tableIds: string[];
}

export interface TableView<R extends FloorReservation = FloorReservation> {
	stage: TableStage;
	/** Orders ready to take to the table. */
	foodReady: number;
	/** Table-QR orders waiting for a waiter, on this table. */
	qrWaiting: number;
	billAsked: boolean;
	/** When the table's check opened, i.e. when it became occupied. */
	seatedSince: Date | null;
	/** The reservation holding or seating the table, if any. */
	reservation: R | null;
	/** The next booking on this free table. */
	next: R | null;
}

const ms = (d: Date | string) => new Date(d).getTime();

/**
 * One table's state at `at`. An open check wins (the table is occupied for as long as it is
 * open); otherwise a seated reservation, then one that starts within the turn time, then free.
 * `awaiting` is the count of QR orders waiting on this table.
 */
export function tableView<R extends FloorReservation>(args: {
	tableId: string;
	check?: FloorCheck | null;
	reservations: R[];
	awaiting?: number;
	at: Date;
	turnMs: number;
}): TableView<R> {
	const { tableId, check, at, turnMs } = args;
	const qrWaiting = args.awaiting ?? 0;
	const mine = args.reservations.filter((r) => r.tableIds.includes(tableId));

	if (check) {
		const stage: TableStage = check.stage === 'ordering' ? 'occupied' : check.stage;
		return {
			stage,
			foodReady: check.readyCount,
			qrWaiting: qrWaiting + check.awaitingAcceptance,
			billAsked: !!check.billRequestedAt,
			seatedSince: new Date(check.openedAt),
			reservation: mine.find((r) => r.status === 'seated') ?? null,
			next: null
		};
	}

	const seated = mine.find((r) => r.status === 'seated' && ms(r.startsAt) <= at.getTime());
	if (seated) {
		return { stage: 'seated', foodReady: 0, qrWaiting, billAsked: false, seatedSince: new Date(seated.startsAt), reservation: seated, next: null };
	}
	const held = mine.find(
		(r) => (r.status === 'pending' || r.status === 'confirmed') && ms(r.startsAt) < at.getTime() + turnMs && ms(r.endsAt) > at.getTime()
	);
	if (held) {
		return { stage: 'reserved', foodReady: 0, qrWaiting, billAsked: false, seatedSince: null, reservation: held, next: null };
	}
	const next = mine.find((r) => (r.status === 'pending' || r.status === 'confirmed') && ms(r.startsAt) > at.getTime()) ?? null;
	return { stage: 'free', foodReady: 0, qrWaiting, billAsked: false, seatedSince: null, reservation: null, next };
}

/** Lower is more urgent: food to serve, then a QR order to accept, then the bill, then clearing. */
export function urgencyRank(v: TableView): number {
	if (v.foodReady > 0) return 0;
	if (v.qrWaiting > 0) return 1;
	if (v.stage === 'needs_payment') return v.billAsked ? 2 : 3;
	if (v.stage === 'ready_to_clear') return 4;
	if (v.stage === 'occupied') return 5;
	if (v.stage === 'seated') return 6;
	if (v.stage === 'reserved') return 7;
	return 8;
}

/** Most urgent first; within a rank, whoever has been at the table longest (or books soonest). */
export function compareUrgency<T extends { view: TableView; name: string }>(a: T, b: T): number {
	const d = urgencyRank(a.view) - urgencyRank(b.view);
	if (d !== 0) return d;
	const when = (v: TableView) => (v.seatedSince ?? (v.reservation ? new Date(v.reservation.startsAt) : null))?.getTime() ?? Infinity;
	const w = when(a.view) - when(b.view);
	if (w !== 0 && Number.isFinite(w)) return w;
	return a.name.localeCompare(b.name, undefined, { numeric: true });
}

/** The status bar's filters. They overlap (a table can be occupied and have food to serve). */
export type FloorFilter = 'all' | 'free' | 'reserved' | 'occupied' | 'serve' | 'pay' | 'clear' | 'qr';

export function matchesFilter(v: TableView, f: FloorFilter): boolean {
	switch (f) {
		case 'all':
			return true;
		case 'free':
			return v.stage === 'free';
		case 'reserved':
			return v.stage === 'reserved';
		case 'occupied':
			return v.stage === 'occupied' || v.stage === 'seated' || v.stage === 'needs_payment' || v.stage === 'ready_to_clear';
		case 'serve':
			return v.foodReady > 0;
		case 'pay':
			return v.stage === 'needs_payment';
		case 'clear':
			return v.stage === 'ready_to_clear';
		case 'qr':
			return v.qrWaiting > 0;
	}
}

export const FILTERS: { key: FloorFilter; label: string }[] = [
	{ key: 'all', label: 'All' },
	{ key: 'serve', label: 'Food to serve' },
	{ key: 'qr', label: 'QR waiting' },
	{ key: 'pay', label: 'Needs payment' },
	{ key: 'clear', label: 'Ready to clear' },
	{ key: 'occupied', label: 'Occupied' },
	{ key: 'reserved', label: 'Reserved' },
	{ key: 'free', label: 'Free' }
];

export function floorCounts(views: TableView[]): Record<FloorFilter, number> {
	const out = {} as Record<FloorFilter, number>;
	for (const { key } of FILTERS) out[key] = views.filter((v) => matchesFilter(v, key)).length;
	return out;
}
