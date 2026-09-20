import { describe, expect, it } from 'vitest';
import { planByBalance, planInRoomOrder, roomPaidCentavos, validateAllocations } from './allocation';

describe('roomPaidCentavos', () => {
	const lines = [
		{ id: 'A', total: 10_100 },
		{ id: 'B', total: 50_000 }
	];
	it('an allocated payment counts only its allocation, per room (₱300 on ₱601 → A ₱101, B ₱199)', () => {
		const rows = [
			{
				amountCentavos: 30_000,
				folioId: 'fA',
				allocations: [
					{ lineId: 'A', amountCentavos: 10_100 },
					{ lineId: 'B', amountCentavos: 19_900 }
				]
			}
		];
		expect(roomPaidCentavos({ rows, folioId: 'fA', lineId: 'A', lines })).toBe(10_100);
		expect(roomPaidCentavos({ rows, folioId: 'fB', lineId: 'B', lines })).toBe(19_900);
	});
	it('a folio-tagged payment counts only on its own room', () => {
		const rows = [{ amountCentavos: 5_000, folioId: 'fA', allocations: [] }];
		expect(roomPaidCentavos({ rows, folioId: 'fA', lineId: 'A', lines })).toBe(5_000);
		expect(roomPaidCentavos({ rows, folioId: 'fB', lineId: 'B', lines })).toBe(0);
	});
	it('an untagged (online / legacy) payment splits pro-rata by room price and sums exactly', () => {
		const rows = [{ amountCentavos: 30_000, folioId: null, allocations: [] }];
		const a = roomPaidCentavos({ rows, folioId: null, lineId: 'A', lines });
		const b = roomPaidCentavos({ rows, folioId: null, lineId: 'B', lines });
		expect(a + b).toBe(30_000);
		expect(a).toBe(5_042);
	});
	it('a single-room order gets the whole untagged payment', () => {
		const one = [{ id: 'A', total: 10_000 }];
		const rows = [{ amountCentavos: 7_777, folioId: null, allocations: [] }];
		expect(roomPaidCentavos({ rows, folioId: null, lineId: 'A', lines: one })).toBe(7_777);
	});
	it('a refund tagged to one room lowers only that room', () => {
		const rows = [
			{ amountCentavos: 30_000, folioId: null, allocations: [] },
			{ amountCentavos: -10_000, folioId: 'fA', allocations: [] }
		];
		expect(roomPaidCentavos({ rows, folioId: 'fA', lineId: 'A', lines })).toBe(5_042 - 10_000);
		expect(roomPaidCentavos({ rows, folioId: 'fB', lineId: 'B', lines })).toBe(30_000 - 5_042);
	});
});

describe('planInRoomOrder / planByBalance / validateAllocations', () => {
	const rooms = [
		{ id: 'A', balanceCentavos: 10_100 },
		{ id: 'B', balanceCentavos: 50_000 }
	];
	it('fills the first room fully, then the next', () => {
		const p = planInRoomOrder(30_000, rooms);
		expect(p.allocations).toEqual([
			{ id: 'A', amountCentavos: 10_100 },
			{ id: 'B', amountCentavos: 19_900 }
		]);
		expect(p.unassignedCentavos).toBe(0);
	});
	it('reports what the rooms cannot take', () => {
		expect(planInRoomOrder(70_000, rooms).unassignedCentavos).toBe(9_900);
	});
	it('splits by what each room still owes and never exceeds a room', () => {
		const p = planByBalance(30_000, rooms);
		expect(p.reduce((s, a) => s + a.amountCentavos, 0)).toBe(30_000);
		expect(p[0]!.amountCentavos).toBeLessThanOrEqual(10_100);
	});
	it('validates sums and per-room limits', () => {
		const ok = [
			{ id: 'A', amountCentavos: 10_100 },
			{ id: 'B', amountCentavos: 19_900 }
		];
		expect(validateAllocations(ok, rooms, 30_000)).toBeNull();
		expect(validateAllocations(ok, rooms, 31_000)).toMatch(/not assigned/);
		expect(validateAllocations([{ id: 'A', amountCentavos: 20_000 }], rooms, 20_000)).toMatch(
			/more than it still owes/
		);
		expect(validateAllocations([{ id: 'X', amountCentavos: 1 }], rooms, 1)).toMatch(/not part/);
	});
});
