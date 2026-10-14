import { describe, expect, it } from 'vitest';
import { establishmentSchema } from './establishment-schema';

const ref = 'org_01HZX3Y5Q8N2V7M4K6R9T1W0AB';

const TYPE = '6f1c1f7e-0b8a-4a50-9c52-0a6b2a1d9e11';

describe('establishmentSchema', () => {
	it('accepts a hotel with a valid org reference', () => {
		const r = establishmentSchema.safeParse({ name: 'Seaside', typeId: TYPE, timezone: 'Asia/Manila', orgRef: ref });
		expect(r.success).toBe(true);
	});
	it('accepts a hotel with no reference yet (linked later)', () => {
		expect(establishmentSchema.safeParse({ name: 'Seaside', typeId: TYPE, timezone: 'Asia/Manila' }).success).toBe(true);
		expect(
			establishmentSchema.safeParse({ name: 'Seaside', typeId: TYPE, timezone: 'Asia/Manila', orgRef: '' }).success
		).toBe(true);
	});
	it('rejects a reference that is given but malformed', () => {
		expect(
			establishmentSchema.safeParse({ name: 'Seaside', typeId: TYPE, timezone: 'Asia/Manila', orgRef: 'org_short' }).success
		).toBe(false);
		expect(
			establishmentSchema.safeParse({ name: 'Seaside', typeId: TYPE, timezone: 'Asia/Manila', orgRef: 'org_mmgroupcompanieshoteltandag' }).success
		).toBe(false);
	});
	it('accepts a business without a reference', () => {
		expect(establishmentSchema.safeParse({ name: 'Cafe', typeId: TYPE, timezone: 'Asia/Manila' }).success).toBe(true);
	});
	it('rejects an unknown timezone and a blank name', () => {
		expect(establishmentSchema.safeParse({ name: 'Cafe', typeId: TYPE, timezone: 'Mars/Olympus' }).success).toBe(false);
		expect(establishmentSchema.safeParse({ name: '  ', typeId: TYPE, timezone: 'UTC' }).success).toBe(false);
	});
});
