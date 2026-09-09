import { describe, expect, it } from 'vitest';
import { partitionExpiredOrders } from './orders';

const NOW = new Date('2026-09-09T12:00:00Z');
const TTL_MS = 60 * 60_000; // 60 minutes

const row = (over: Partial<{ id: string; status: string; createdAt: Date }>) => ({
	id: 'o1',
	status: 'pending_payment',
	createdAt: new Date('2026-09-09T10:00:00Z'),
	...over
});

describe('partitionExpiredOrders', () => {
	it('expires a pending order older than the TTL', () => {
		const { expired, kept } = partitionExpiredOrders([row({})], { now: NOW, ttlMs: TTL_MS });
		expect(expired.map((r) => r.id)).toEqual(['o1']);
		expect(kept).toEqual([]);
	});

	it('keeps a pending order younger than the TTL', () => {
		const fresh = row({ createdAt: new Date('2026-09-09T11:30:00Z') });
		const { expired, kept } = partitionExpiredOrders([fresh], { now: NOW, ttlMs: TTL_MS });
		expect(expired).toEqual([]);
		expect(kept.map((r) => r.id)).toEqual(['o1']);
	});

	it('treats the TTL boundary as expired (inclusive)', () => {
		const exactly = row({ createdAt: new Date(NOW.getTime() - TTL_MS) });
		const { expired } = partitionExpiredOrders([exactly], { now: NOW, ttlMs: TTL_MS });
		expect(expired).toHaveLength(1);
	});

	it('never expires an order that is not pending_payment, however old', () => {
		const old = new Date('2026-01-01T00:00:00Z');
		const rows = [
			row({ id: 'confirmed', status: 'confirmed', createdAt: old }),
			row({ id: 'cancelled', status: 'cancelled', createdAt: old })
		];
		const { expired, kept } = partitionExpiredOrders(rows, { now: NOW, ttlMs: TTL_MS });
		expect(expired).toEqual([]);
		expect(kept.map((r) => r.id)).toEqual(['confirmed', 'cancelled']);
	});

	it('splits a mixed batch', () => {
		const rows = [
			row({ id: 'stale' }),
			row({ id: 'fresh', createdAt: new Date('2026-09-09T11:59:00Z') }),
			row({ id: 'paid', status: 'confirmed' })
		];
		const { expired, kept } = partitionExpiredOrders(rows, { now: NOW, ttlMs: TTL_MS });
		expect(expired.map((r) => r.id)).toEqual(['stale']);
		expect(kept.map((r) => r.id)).toEqual(['fresh', 'paid']);
	});

	it('returns empty for empty input', () => {
		expect(partitionExpiredOrders([], { now: NOW, ttlMs: TTL_MS })).toEqual({ expired: [], kept: [] });
	});
});
