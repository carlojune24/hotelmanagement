import { describe, expect, it } from 'vitest';
import { parseLedgerFilter } from './paymongo-ledger';

describe('parseLedgerFilter source', () => {
	const src = (q: string) => parseLedgerFilter(new URL(`http://x/?${q}`)).source;
	it('reads hotel and dining, anything else is all', () => {
		expect(src('src=hotel')).toBe('hotel');
		expect(src('src=dining')).toBe('dining');
		expect(src('src=evil')).toBe('all');
		expect(src('')).toBe('all');
	});
});
