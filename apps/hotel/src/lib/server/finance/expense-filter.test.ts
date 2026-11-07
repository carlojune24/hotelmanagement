import { describe, expect, it } from 'vitest';
import { parseExpenseFilter } from './expenses';

describe('parseExpenseFilter', () => {
	const f = (q: string) => parseExpenseFilter(new URL(`http://x/?${q}`));
	it('reads source, status and dates; anything odd is dropped', () => {
		expect(f('src=dining&status=paid&from=2026-11-01&to=2026-11-30')).toEqual({
			source: 'dining',
			status: 'paid',
			from: '2026-11-01',
			to: '2026-11-30'
		});
		expect(f('src=bar&status=nope&from=yesterday')).toEqual({ source: undefined, status: undefined, from: undefined, to: undefined });
	});
});
