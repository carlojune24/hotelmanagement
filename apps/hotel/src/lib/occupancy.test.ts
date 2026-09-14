import { describe, it, expect } from 'vitest';
import { resolveOccupancyPlan, type RoomTypeOccupancyPolicy } from './occupancy';

const withExtraBed: RoomTypeOccupancyPolicy = {
	maxOccupancy: 2,
	extraBedAllowed: true,
	maxExtraBeds: 1,
	extraBedCapacity: 1
};

const noExtraBed: RoomTypeOccupancyPolicy = {
	maxOccupancy: 2,
	extraBedAllowed: false,
	maxExtraBeds: 0,
	extraBedCapacity: 1
};

describe('resolveOccupancyPlan', () => {
	it('fits on base occupancy alone when the party is small enough', () => {
		const plan = resolveOccupancyPlan(withExtraBed, 4, 2);
		expect(plan).toMatchObject({ fitsBase: true, fits: true, extraBedsNeeded: 0, suggestedRoomCount: null });
	});

	it('offers an extra bed when the party exceeds base occupancy but fits with one', () => {
		// 3 guests, 1 room, max 2 — needs exactly 1 extra bed.
		const plan = resolveOccupancyPlan(withExtraBed, 3, 1);
		expect(plan).toMatchObject({ fitsBase: false, fits: true, extraBedsNeeded: 1 });
	});

	it('the reported real case: 3 guests, 2 rooms, max 2 each — already fits, no extra bed', () => {
		const plan = resolveOccupancyPlan(withExtraBed, 3, 2);
		expect(plan).toMatchObject({ fitsBase: true, fits: true, extraBedsNeeded: 0 });
	});

	it('suggests more rooms when extra beds alone are not enough', () => {
		// 6 guests, 1 room, max 2 + 1 extra bed = capacity 3 — nowhere near enough.
		const plan = resolveOccupancyPlan(withExtraBed, 6, 1);
		expect(plan.fits).toBe(false);
		expect(plan.suggestedRoomCount).toBe(3); // 3 rooms x 2 = 6, first room count that fits on base alone
	});

	it('suggests more rooms even when the room type disallows extra beds entirely', () => {
		const plan = resolveOccupancyPlan(noExtraBed, 3, 1);
		expect(plan.fits).toBe(false);
		expect(plan.extraBedsNeeded).toBe(0);
		expect(plan.suggestedRoomCount).toBe(2);
	});

	it('caps the room-count suggestion at maxRoomCount and reports blocked with no suggestion beyond it', () => {
		const plan = resolveOccupancyPlan(noExtraBed, 100, 1, 4);
		expect(plan.fits).toBe(false);
		expect(plan.suggestedRoomCount).toBeNull();
		expect(plan.blockingReason).toMatch(/can't fit/);
	});

	it('still suggests a room count even when extra beds already cover the party (so the guest can shed the rollaway)', () => {
		// 4 guests, 1 room, max 2 + up to 2 extra beds = fits with 2 extra beds, but 2 rooms
		// (4 capacity, no extra bed) also cleanly covers it — both should be reported.
		const policy: RoomTypeOccupancyPolicy = { ...withExtraBed, maxExtraBeds: 2 };
		const plan = resolveOccupancyPlan(policy, 4, 1);
		expect(plan.fits).toBe(true);
		expect(plan.extraBedsNeeded).toBe(2);
		expect(plan.suggestedRoomCount).toBe(2);
	});
});
