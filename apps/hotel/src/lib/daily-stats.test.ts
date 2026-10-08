import { describe, it, expect } from 'vitest';
import { buildDailyStats, dateList, validateRange, MAX_DAILY_STATS_DAYS } from './daily-stats';

describe('validateRange', () => {
	it('accepts a normal range', () => {
		expect(validateRange('2026-09-01', '2026-09-30')).toEqual({ ok: true, from: '2026-09-01', to: '2026-09-30' });
	});
	it('rejects bad, reversed and oversized ranges', () => {
		expect(validateRange(null, '2026-09-30').ok).toBe(false);
		expect(validateRange('2026-13-40', '2026-09-30').ok).toBe(false);
		expect(validateRange('2026-09-30', '2026-09-01').ok).toBe(false);
		expect(validateRange('2024-01-01', '2026-01-01').ok).toBe(false);
		expect(dateList('2026-01-01', '2026-01-03')).toHaveLength(3);
		expect(MAX_DAILY_STATS_DAYS).toBe(400);
	});
});

describe('buildDailyStats', () => {
	const hotels = [
		{ id: 'a', today: '2026-09-03', rooms: 10 },
		{ id: 'b', today: '2026-09-02', rooms: 4 }
	];

	it('gives every day a row (zeros when quiet) and stops at each hotel own today', () => {
		const rows = buildDailyStats('2026-09-01', '2026-09-05', { hotels, nights: [], arrivals: [], cash: [] });
		expect(rows.filter((r) => r.hotel_id === 'a').map((r) => r.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
		expect(rows.filter((r) => r.hotel_id === 'b')).toHaveLength(2);
		expect(rows[0]).toMatchObject({ rooms_available: 10, room_nights_sold: 0, guests_arrived: 0, cash: [] });
	});

	it('merges nights, arrivals and cash onto the right hotel and date', () => {
		const rows = buildDailyStats('2026-09-01', '2026-09-02', {
			hotels,
			nights: [{ hotelId: 'a', date: '2026-09-02', roomNights: 3, guestNights: 5, revenueMinor: 450000 }],
			arrivals: [{ hotelId: 'a', date: '2026-09-02', stays: 2, guests: 5, tourists: 4, touristStays: 1 }],
			cash: [{ hotelId: 'a', date: '2026-09-02', category: 'room_revenue', direction: 'in', amountMinor: 450000 }]
		});
		const r = rows.find((x) => x.hotel_id === 'a' && x.date === '2026-09-02')!;
		expect(r).toMatchObject({
			room_nights_sold: 3, guest_nights: 5, room_revenue_minor: 450000,
			stays_arrived: 2, guests_arrived: 5, tourists_recorded: 4, stays_with_tourist_count: 1
		});
		expect(r.cash).toEqual([{ category: 'room_revenue', direction: 'in', amount_minor: 450000 }]);
		expect(rows.find((x) => x.hotel_id === 'b' && x.date === '2026-09-02')!.room_nights_sold).toBe(0);
	});
});
