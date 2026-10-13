import { describe, expect, it } from 'vitest';
import { establishmentSchema } from './establishment-schema';

const ref = 'org_01HZX3Y5Q8N2V7M4K6R9T1W0AB';

describe('establishmentSchema', () => {
	it('accepts a hotel with a valid org reference', () => {
		const r = establishmentSchema.safeParse({ name: 'Seaside', kind: 'hotel', timezone: 'Asia/Manila', orgRef: ref });
		expect(r.success).toBe(true);
	});
	it('accepts a hotel with no reference yet (linked later)', () => {
		expect(establishmentSchema.safeParse({ name: 'Seaside', kind: 'hotel', timezone: 'Asia/Manila' }).success).toBe(true);
		expect(
			establishmentSchema.safeParse({ name: 'Seaside', kind: 'hotel', timezone: 'Asia/Manila', orgRef: '' }).success
		).toBe(true);
	});
	it('rejects a reference that is given but malformed', () => {
		expect(
			establishmentSchema.safeParse({ name: 'Seaside', kind: 'hotel', timezone: 'Asia/Manila', orgRef: 'org_short' }).success
		).toBe(false);
		expect(
			establishmentSchema.safeParse({ name: 'Seaside', kind: 'hotel', timezone: 'Asia/Manila', orgRef: 'org_mmgroupcompanieshoteltandag' }).success
		).toBe(false);
	});
	it('accepts a business without a reference', () => {
		expect(establishmentSchema.safeParse({ name: 'Cafe', kind: 'business', timezone: 'Asia/Manila' }).success).toBe(true);
	});
	it('rejects an unknown timezone and a blank name', () => {
		expect(establishmentSchema.safeParse({ name: 'Cafe', kind: 'business', timezone: 'Mars/Olympus' }).success).toBe(false);
		expect(establishmentSchema.safeParse({ name: '  ', kind: 'business', timezone: 'UTC' }).success).toBe(false);
	});
});
