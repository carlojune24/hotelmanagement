import { describe, expect, it, vi } from 'vitest';

// front-desk.ts pulls in the DB client at import time; only the pure helper is under test.
vi.mock('./db/index', () => ({ db: {} }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

const { walkInAmountPaid, WalkInError } = await import('./front-desk');

describe('walkInAmountPaid', () => {
	it('cash tendered below the total records only what was received', () => {
		expect(walkInAmountPaid(500_000, { method: 'cash', tenderedCentavos: 200_000 })).toBe(200_000);
	});
	it('cash at or above the total settles it (the rest is change)', () => {
		expect(walkInAmountPaid(500_000, { method: 'cash', tenderedCentavos: 500_000 })).toBe(500_000);
		expect(walkInAmountPaid(500_000, { method: 'cash', tenderedCentavos: 600_000 })).toBe(500_000);
	});
	it('blank tendered, or any non-cash method, settles the full total', () => {
		expect(walkInAmountPaid(500_000, { method: 'cash', tenderedCentavos: null })).toBe(500_000);
		expect(walkInAmountPaid(500_000, { method: 'gcash', tenderedCentavos: 100_000 })).toBe(500_000);
	});
	it('rejects zero or negative cash rather than recording a nil payment', () => {
		expect(() => walkInAmountPaid(500_000, { method: 'cash', tenderedCentavos: 0 })).toThrow(
			WalkInError
		);
	});
});
