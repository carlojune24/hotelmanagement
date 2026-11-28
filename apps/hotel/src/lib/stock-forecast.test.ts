import { describe, expect, it } from 'vitest';
import { averageDailyUse, daysLeftLabel, reorder, type DayTotals } from './stock-forecast';

const days = (n: number, d: DayTotals): DayTotals[] => Array.from({ length: n }, () => ({ ...d }));

describe('averageDailyUse', () => {
	it('averages over the days the item had stock', () => {
		// 10 pcs a day for 14 days from an opening of 500 pcs.
		expect(averageDailyUse(500_000, days(14, { net: -10_000, used: 10_000 }))).toEqual({ usedMilli: 140_000, stockedDays: 14, avgMilli: 10_000 });
	});

	it("doesn't count days at zero as no demand", () => {
		// 7 days of use, ran out, then 7 days at zero before a restock: average stays 10/day, not 5.
		const history = [...days(7, { net: -10_000, used: 10_000 }), ...days(7, { net: 0, used: 0 })];
		expect(averageDailyUse(70_000, history).avgMilli).toBe(10_000);
	});

	it('refuses to guess with under a week of history', () => {
		expect(averageDailyUse(0, [{ net: 100_000, used: 0 }, ...days(3, { net: -5_000, used: 5_000 })]).avgMilli).toBeNull();
	});
});

describe('reorder', () => {
	const base = { unit: 'pcs' as const, leadDays: 2, coverDays: 14, reorderLevelMilli: null };

	it('flags an item that runs out within the lead time and sizes the order', () => {
		// 10/day, 15 on hand → 1.5 days left (< 2-day lead). Need 10 × (2 + 14) − 15 = 145 pcs.
		expect(reorder({ ...base, onHandMilli: 15_000, avgMilli: 10_000 })).toEqual({ daysLeft: 1.5, needsOrder: true, reason: 'runs_out', suggestedMilli: 145_000 });
	});

	it('leaves a well-stocked item alone', () => {
		expect(reorder({ ...base, onHandMilli: 300_000, avgMilli: 10_000 })).toMatchObject({ daysLeft: 30, needsOrder: false, suggestedMilli: null });
	});

	it('marks out of stock, and rounds weights up to 100 g', () => {
		const r = reorder({ ...base, unit: 'g', onHandMilli: -50_000, avgMilli: 1_234_000, leadDays: null, coverDays: 7 });
		expect(r.reason).toBe('out');
		// default lead 2 + cover 7 = 9 days × 1,234 g + 50 g owed = 11,156 g → 11.2 kg
		expect(r.suggestedMilli).toBe(11_200_000);
	});

	it('falls back to the reorder level when there is no usage history', () => {
		expect(reorder({ ...base, onHandMilli: 5_000, avgMilli: null, reorderLevelMilli: 10_000 })).toEqual({ daysLeft: null, needsOrder: true, reason: 'low', suggestedMilli: null });
	});
});

describe('daysLeftLabel', () => {
	it('rounds down and caps', () => {
		expect([daysLeftLabel(null), daysLeftLabel(0.4), daysLeftLabel(1.9), daysLeftLabel(6.7), daysLeftLabel(400)]).toEqual([
			null,
			'< 1 day left',
			'≈ 1 day left',
			'≈ 6 days left',
			'90+ days left'
		]);
	});
});
