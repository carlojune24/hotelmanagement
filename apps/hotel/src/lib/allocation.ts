/** Per-room money. Every room keeps its own record of what it has been paid; the booking (order)
 *  is the parent only for viewing and for taking ONE payment across several rooms. Pure, no DB.
 *  Amounts are integer centavos. */
import { allocateOrderPayment } from './downpayment';

/** One payment on an order, as needed to work out a room's share of it. */
export interface RoomPayRow {
	amountCentavos: number;
	/** The room's folio the payment was posted on (per-room desk payment, refund, city ledger,
	 *  deposit forfeiture), or null for an order-level payment. */
	folioId: string | null;
	/** Explicit per-room split of THIS payment (see `payment_allocations`); empty if none. */
	allocations: { lineId: string; amountCentavos: number }[];
}

/**
 * How much of the order's payments count toward ONE room:
 *  1. a payment with allocation rows counts only its allocation for that room;
 *  2. otherwise a payment tagged to a folio counts in full on that folio's room only;
 *  3. otherwise (an untagged online / legacy payment) it is split across all the order's lines
 *     pro-rata by line total, largest-remainder — so a single-room order gets all of it.
 * `lines` must be in one stable order (every caller sorts the same way) so the split is identical
 * everywhere.
 */
export function roomPaidCentavos(args: {
	rows: RoomPayRow[];
	folioId: string | null;
	lineId: string;
	lines: { id: string; total: number }[];
}): number {
	const { rows, folioId, lineId, lines } = args;
	const idx = lines.findIndex((l) => l.id === lineId);
	let sum = 0;
	for (const r of rows) {
		if (r.allocations.length > 0) {
			sum += r.allocations
				.filter((a) => a.lineId === lineId)
				.reduce((s, a) => s + a.amountCentavos, 0);
		} else if (r.folioId) {
			if (folioId != null && r.folioId === folioId) sum += r.amountCentavos;
		} else if (idx >= 0) {
			sum += allocateOrderPayment(
				r.amountCentavos,
				lines.map((l) => l.total)
			)[idx]!;
		}
	}
	return sum;
}

export interface AllocRoom {
	id: string;
	/** What the room still owes (charges − paid); a room in credit counts as 0. */
	balanceCentavos: number;
}

/** Split one payment across rooms IN ROOM ORDER: the first room is filled up to its balance, then
 *  the next, and so on. Whatever the rooms cannot take is returned as `unassignedCentavos`. */
export function planInRoomOrder(
	amountCentavos: number,
	rooms: AllocRoom[]
): { allocations: { id: string; amountCentavos: number }[]; unassignedCentavos: number } {
	let remaining = amountCentavos;
	const allocations: { id: string; amountCentavos: number }[] = [];
	for (const r of rooms) {
		const take = Math.min(remaining, Math.max(0, r.balanceCentavos));
		allocations.push({ id: r.id, amountCentavos: take });
		remaining -= take;
	}
	return { allocations, unassignedCentavos: remaining };
}

/** Split one payment across rooms in proportion to what each still owes (largest-remainder). */
export function planByBalance(
	amountCentavos: number,
	rooms: AllocRoom[]
): { id: string; amountCentavos: number }[] {
	const owed = rooms.map((r) => Math.max(0, r.balanceCentavos));
	const capped = Math.min(
		amountCentavos,
		owed.reduce((a, b) => a + b, 0)
	);
	const shares = allocateOrderPayment(capped, owed);
	return rooms.map((r, i) => ({ id: r.id, amountCentavos: shares[i]! }));
}

/** `null` when the per-room amounts are a valid split of `amountCentavos`; otherwise a plain sentence. */
export function validateAllocations(
	allocations: { id: string; amountCentavos: number }[],
	rooms: AllocRoom[],
	amountCentavos: number
): string | null {
	const byId = new Map(rooms.map((r) => [r.id, r]));
	let sum = 0;
	for (const a of allocations) {
		if (!Number.isInteger(a.amountCentavos) || a.amountCentavos < 0)
			return "Each room's amount must be zero or more.";
		const room = byId.get(a.id);
		if (!room) return 'One of the rooms is not part of this booking.';
		if (a.amountCentavos > Math.max(0, room.balanceCentavos))
			return 'A room was given more than it still owes.';
		sum += a.amountCentavos;
	}
	if (sum !== amountCentavos)
		return sum < amountCentavos
			? 'Some of the payment is not assigned to a room yet.'
			: 'More than the payment was assigned to the rooms.';
	return null;
}
