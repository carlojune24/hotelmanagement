import { describe, expect, it } from 'vitest';
import { SCENARIOS, evaluate } from './dtr-scenarios';

/**
 * Every row of the DTR Guide is asserted here, so the documentation can never drift from the engine.
 * Whatever a scenario says it should produce, the engine must produce.
 */
describe('DTR scenarios', () => {
	it('has unique ids', () => {
		const ids = SCENARIOS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	for (const sc of SCENARIOS) {
		it(`${sc.id} ${sc.title}`, () => {
			const got = evaluate(sc);
			const want = sc.expect;
			expect(got.worked, 'worked').toBe(want.worked);
			expect(got.late, 'late').toBe(want.late ?? 0);
			expect(got.under, 'under').toBe(want.under ?? 0);
			expect(got.ot, 'ot').toBe(want.ot ?? 0);
			expect(got.unapprovedOt, 'unapproved ot').toBe(want.unapprovedOt ?? 0);
			if (want.night !== undefined) expect(got.night, 'night').toBe(want.night);
			expect([...got.flags].sort(), 'flags').toEqual([...(want.flags ?? [])].sort());
			expect(got.absent, 'absent').toBe(want.absent ?? false);
			expect(got.leaveCredit, 'leave credit').toBe(want.leaveCredit ?? 0);
		});
	}

	it('a scheduled shift is always fully accounted for: worked + late + undertime = the paid day', () => {
		// Only for plain punched days with no overtime, leave or memo, where the identity must hold (an absent day is deducted whole).
		for (const sc of SCENARIOS.filter(
			(s) => (s.group === 'split' || s.group === 'plain') && s.punches.length > 1 && !s.expect.flags?.includes('single_punch') && s.expect.worked !== 0
		)) {
			const g = evaluate(sc);
			expect(g.worked + g.late + g.under, sc.id).toBe(480);
		}
	});
});
