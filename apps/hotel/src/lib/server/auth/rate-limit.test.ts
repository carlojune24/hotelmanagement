import { describe, expect, it } from 'vitest';
import { RateLimiter, tooManyMessage } from './rate-limit';

function make(max = 3, windowMs = 60_000) {
	let t = 1_000_000;
	const rl = new RateLimiter({ max, windowMs }, () => t);
	return { rl, advance: (ms: number) => (t += ms) };
}

describe('RateLimiter', () => {
	it('allows attempts until max failures, then blocks', () => {
		const { rl } = make(3);
		for (let i = 0; i < 3; i++) {
			expect(rl.retryAfter('k')).toBe(0);
			rl.recordFailure('k');
		}
		expect(rl.retryAfter('k')).toBeGreaterThan(0);
	});

	it('reports remaining seconds, rounded up', () => {
		const { rl, advance } = make(1, 60_000);
		rl.recordFailure('k');
		advance(59_500);
		expect(rl.retryAfter('k')).toBe(1);
	});

	it('unblocks once the window elapses', () => {
		const { rl, advance } = make(1, 60_000);
		rl.recordFailure('k');
		advance(60_000);
		expect(rl.retryAfter('k')).toBe(0);
		rl.recordFailure('k');
		expect(rl.retryAfter('k')).toBeGreaterThan(0);
	});

	it('reset clears a key (successful login)', () => {
		const { rl } = make(1);
		rl.recordFailure('k');
		rl.reset('k');
		expect(rl.retryAfter('k')).toBe(0);
	});

	it('keys are independent', () => {
		const { rl } = make(1);
		rl.recordFailure('a');
		expect(rl.retryAfter('b')).toBe(0);
	});
});

describe('tooManyMessage', () => {
	it('pluralises minutes', () => {
		expect(tooManyMessage(30)).toContain('1 minute.');
		expect(tooManyMessage(300)).toContain('5 minutes.');
	});
});
