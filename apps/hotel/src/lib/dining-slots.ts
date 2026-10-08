/** Pure slot + table-assignment logic for dining reservations. No database — the server
 *  module loads tables and existing bookings and feeds them in here, so the rules that
 *  decide "is this slot bookable?" are testable on their own. */

export interface SlotConfig {
	/** `HH:MM` first seating, in the hotel's timezone. */
	seatingOpen: string;
	/** `HH:MM` last seating start. */
	lastSeating: string;
	slotMinutes: number;
	turnMinutes: number;
	minNoticeMinutes: number;
	advanceDays: number;
	maxPartySize: number;
}

export interface TableLite {
	id: string;
	seats: number;
	name?: string;
}

/** An existing reservation's hold on one or more tables. */
export interface BusyHold {
	tableIds: string[];
	startsAt: Date;
	endsAt: Date;
}

export interface Slot {
	/** `HH:MM` local start. */
	time: string;
	startsAt: Date;
	endsAt: Date;
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const toMinutes = (hhmm: string) => {
	const [h, m] = hhmm.split(':').map(Number);
	return h! * 60 + m!;
};
const fromMinutes = (n: number) =>
	`${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(tz: string, at: Date): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(at);
	const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
	const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
	return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a wall-clock `date` + `time` occurs in `tz`. Handles zones with DST by
 *  re-checking the offset once after the first guess. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
	const [y, mo, d] = date.split('-').map(Number);
	const [h, mi] = time.split(':').map(Number);
	const naive = Date.UTC(y!, mo! - 1, d!, h!, mi!);
	let guess = naive - tzOffsetMs(tz, new Date(naive));
	guess = naive - tzOffsetMs(tz, new Date(guess));
	return new Date(guess);
}

/** `YYYY-MM-DD` and `HH:MM` of an instant as seen in `tz`. */
export function localParts(at: Date, tz: string): { date: string; time: string } {
	const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(at);
	const time = new Intl.DateTimeFormat('en-GB', {
		timeZone: tz,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(at);
	return { date, time };
}

/** Every start time a venue offers on `date`, with min-notice and advance-window applied. */
export function listSlots(cfg: SlotConfig, date: string, tz: string, now: Date): Slot[] {
	if (!TIME_RE.test(cfg.seatingOpen) || !TIME_RE.test(cfg.lastSeating)) return [];
	if (cfg.slotMinutes < 5 || cfg.turnMinutes < 15) return [];
	const first = toMinutes(cfg.seatingOpen);
	const last = toMinutes(cfg.lastSeating);
	const earliest = now.getTime() + cfg.minNoticeMinutes * 60_000;
	const latest = now.getTime() + cfg.advanceDays * 86_400_000;

	const slots: Slot[] = [];
	for (let m = first; m <= last; m += cfg.slotMinutes) {
		const time = fromMinutes(m);
		const startsAt = zonedToUtc(date, time, tz);
		if (startsAt.getTime() < earliest || startsAt.getTime() > latest) continue;
		slots.push({ time, startsAt, endsAt: new Date(startsAt.getTime() + cfg.turnMinutes * 60_000) });
	}
	return slots;
}

/** Tables with no hold overlapping [startsAt, endsAt). Back-to-back holds do not conflict. */
export function freeTables(
	tables: TableLite[],
	holds: BusyHold[],
	startsAt: Date,
	endsAt: Date,
	ignoreHold?: BusyHold
): TableLite[] {
	const busy = new Set<string>();
	for (const h of holds) {
		if (h === ignoreHold) continue;
		if (h.startsAt < endsAt && startsAt < h.endsAt) h.tableIds.forEach((id) => busy.add(id));
	}
	return tables.filter((t) => !busy.has(t.id));
}

/** Best single table for a party: the smallest one that fits (so a 2-top isn't wasted on a
 *  party of 2 only when a 10-top is left). Ties break on name for a stable result. */
export function bestTable(free: TableLite[], partySize: number): TableLite | null {
	const fits = free.filter((t) => t.seats >= partySize);
	fits.sort((a, b) => a.seats - b.seats || (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id));
	return fits[0] ?? null;
}

export interface SlotAvailability extends Slot {
	available: boolean;
}

/** Each slot on `date`, flagged bookable for `partySize` if some single table is free. */
export function availableSlots(args: {
	cfg: SlotConfig;
	tables: TableLite[];
	holds: BusyHold[];
	date: string;
	tz: string;
	now: Date;
	partySize: number;
}): SlotAvailability[] {
	const { cfg, tables, holds, date, tz, now, partySize } = args;
	if (partySize < 1 || partySize > cfg.maxPartySize) return [];
	return listSlots(cfg, date, tz, now).map((slot) => ({
		...slot,
		available: bestTable(freeTables(tables, holds, slot.startsAt, slot.endsAt), partySize) !== null
	}));
}

/** Largest party a guest could ever book: capped by the venue setting and its biggest table. */
export function bookablePartyCap(maxPartySize: number, tables: TableLite[]): number {
	const biggest = tables.reduce((m, t) => Math.max(m, t.seats), 0);
	return Math.min(maxPartySize, biggest);
}

/** Allowed status moves. A finished or cancelled reservation never reopens. */
export const RESERVATION_TRANSITIONS: Record<string, string[]> = {
	pending: ['confirmed', 'cancelled', 'no_show'],
	confirmed: ['seated', 'cancelled', 'no_show'],
	seated: ['completed'],
	completed: [],
	no_show: [],
	cancelled: []
};

export const canTransition = (from: string, to: string) =>
	RESERVATION_TRANSITIONS[from]?.includes(to) ?? false;

/** Reservations that still hold a table. */
export const HOLDING_STATUSES = ['pending', 'confirmed', 'seated'] as const;
