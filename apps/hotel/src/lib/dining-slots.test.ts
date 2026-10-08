import { describe, expect, it } from 'vitest';
import {
	availableSlots,
	bestTable,
	bookablePartyCap,
	canTransition,
	freeTables,
	listSlots,
	localParts,
	zonedToUtc,
	type BusyHold,
	type SlotConfig,
	type TableLite
} from './dining-slots';

const TZ = 'Asia/Manila'; // UTC+8, no DST
const cfg: SlotConfig = {
	seatingOpen: '11:00',
	lastSeating: '13:00',
	slotMinutes: 30,
	turnMinutes: 90,
	minNoticeMinutes: 60,
	advanceDays: 60,
	maxPartySize: 8
};
const tables: TableLite[] = [
	{ id: 't2', seats: 2, name: 'T2' },
	{ id: 't4', seats: 4, name: 'T4' },
	{ id: 't8', seats: 8, name: 'T8' }
];
const longAgo = new Date('2026-10-01T00:00:00Z'); // well before the test dates, inside the 60-day window

describe('zonedToUtc / localParts', () => {
	it('converts a Manila wall-clock time to the right UTC instant', () => {
		expect(zonedToUtc('2026-10-10', '19:00', TZ).toISOString()).toBe('2026-10-10T11:00:00.000Z');
	});
	it('round-trips through localParts', () => {
		const at = zonedToUtc('2026-10-10', '23:30', TZ);
		expect(localParts(at, TZ)).toEqual({ date: '2026-10-10', time: '23:30' });
	});
	it('handles a DST zone', () => {
		// New York is UTC-4 in October (EDT), UTC-5 in January (EST)
		expect(zonedToUtc('2026-10-10', '12:00', 'America/New_York').toISOString()).toBe('2026-10-10T16:00:00.000Z');
		expect(zonedToUtc('2026-01-10', '12:00', 'America/New_York').toISOString()).toBe('2026-01-10T17:00:00.000Z');
	});
});

describe('listSlots', () => {
	it('lists every start from first to last seating inclusive', () => {
		const slots = listSlots(cfg, '2026-10-10', TZ, longAgo);
		expect(slots.map((s) => s.time)).toEqual(['11:00', '11:30', '12:00', '12:30', '13:00']);
		expect(slots[0]!.endsAt.getTime() - slots[0]!.startsAt.getTime()).toBe(90 * 60_000);
	});
	it('drops slots inside the minimum-notice window', () => {
		// "now" is 11:10 local → earliest bookable start is 12:10
		const now = zonedToUtc('2026-10-10', '11:10', TZ);
		expect(listSlots(cfg, '2026-10-10', TZ, now).map((s) => s.time)).toEqual(['12:30', '13:00']);
	});
	it('drops dates beyond the advance window', () => {
		const now = zonedToUtc('2026-10-10', '09:00', TZ);
		expect(listSlots({ ...cfg, advanceDays: 7 }, '2026-10-30', TZ, now)).toEqual([]);
	});
	it('returns nothing when seating hours are unset or invalid', () => {
		expect(listSlots({ ...cfg, seatingOpen: '' }, '2026-10-10', TZ, longAgo)).toEqual([]);
		expect(listSlots({ ...cfg, lastSeating: '25:00' }, '2026-10-10', TZ, longAgo)).toEqual([]);
	});
});

describe('table assignment', () => {
	it('picks the smallest table that fits', () => {
		expect(bestTable(tables, 2)!.id).toBe('t2');
		expect(bestTable(tables, 3)!.id).toBe('t4');
		expect(bestTable(tables, 5)!.id).toBe('t8');
	});
	it('returns null when no table is big enough', () => {
		expect(bestTable(tables, 9)).toBeNull();
	});
	it('treats overlapping holds as busy but allows back-to-back', () => {
		const start = zonedToUtc('2026-10-10', '12:00', TZ);
		const end = new Date(start.getTime() + 90 * 60_000);
		const hold: BusyHold = { tableIds: ['t2'], startsAt: start, endsAt: end };
		// a party starting exactly when the hold ends does not conflict
		const after = freeTables(tables, [hold], end, new Date(end.getTime() + 90 * 60_000));
		expect(after.map((t) => t.id)).toContain('t2');
		// an overlapping one does
		const during = freeTables(tables, [hold], new Date(start.getTime() + 30 * 60_000), new Date(end.getTime() + 30 * 60_000));
		expect(during.map((t) => t.id)).not.toContain('t2');
	});
});

describe('availableSlots', () => {
	const date = '2026-10-10';
	it('flags a slot unavailable once every fitting table is held', () => {
		const start = zonedToUtc(date, '12:00', TZ);
		const holds: BusyHold[] = [
			{ tableIds: ['t4'], startsAt: start, endsAt: new Date(start.getTime() + 90 * 60_000) },
			{ tableIds: ['t8'], startsAt: start, endsAt: new Date(start.getTime() + 90 * 60_000) }
		];
		const slots = availableSlots({ cfg, tables, holds, date, tz: TZ, now: longAgo, partySize: 4 });
		const at = (t: string) => slots.find((s) => s.time === t)!.available;
		expect(at('11:00')).toBe(false); // 11:00-12:30 overlaps the 12:00 holds
		expect(at('12:00')).toBe(false);
		expect(at('13:00')).toBe(false); // still inside 12:00-13:30
		// a party of 2 still has the 2-top at 12:00
		const two = availableSlots({ cfg, tables, holds, date, tz: TZ, now: longAgo, partySize: 2 });
		expect(two.find((s) => s.time === '12:00')!.available).toBe(true);
	});
	it('returns no slots for a party over the venue maximum', () => {
		expect(availableSlots({ cfg: { ...cfg, maxPartySize: 4 }, tables, holds: [], date, tz: TZ, now: longAgo, partySize: 5 })).toEqual([]);
	});
});

describe('bookablePartyCap / transitions', () => {
	it('caps by the biggest table', () => {
		expect(bookablePartyCap(12, tables)).toBe(8);
		expect(bookablePartyCap(6, tables)).toBe(6);
		expect(bookablePartyCap(6, [])).toBe(0);
	});
	it('only allows sensible status moves', () => {
		expect(canTransition('pending', 'confirmed')).toBe(true);
		expect(canTransition('confirmed', 'seated')).toBe(true);
		expect(canTransition('seated', 'completed')).toBe(true);
		expect(canTransition('completed', 'pending')).toBe(false);
		expect(canTransition('cancelled', 'confirmed')).toBe(false);
		expect(canTransition('seated', 'cancelled')).toBe(false);
	});
});
