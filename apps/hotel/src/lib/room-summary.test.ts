import { describe, expect, it } from 'vitest';
import { summarizeRooms, type RoomSummaryCell } from './room-summary';

const cell = (status: RoomSummaryCell['status'], guests = 0): RoomSummaryCell => ({
	status,
	occupant: status === 'occupied' || status === 'departing' ? { occupancy: guests } : null
});

describe('summarizeRooms', () => {
	it('counts departing (and overdue) rooms as occupied', () => {
		const s = summarizeRooms([cell('occupied', 2), cell('departing', 1), cell('vacant'), cell('reserved')]);
		expect(s).toEqual({ occupiedRooms: 2, inHouseGuests: 3, sellableRooms: 4, occupancyPct: 50 });
	});

	it('leaves out-of-order rooms out of the sellable total', () => {
		const s = summarizeRooms([cell('occupied', 2), cell('ooo'), cell('vacant')]);
		expect(s.sellableRooms).toBe(2);
		expect(s.occupancyPct).toBe(50);
	});

	it('rounds to a whole percent', () => {
		expect(summarizeRooms([cell('occupied', 1), cell('vacant'), cell('vacant')]).occupancyPct).toBe(33);
	});

	it('is 0% with nothing sellable', () => {
		expect(summarizeRooms([cell('ooo')]).occupancyPct).toBe(0);
		expect(summarizeRooms([]).occupancyPct).toBe(0);
	});
});
