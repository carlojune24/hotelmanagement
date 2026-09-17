import { describe, expect, it } from 'vitest';
import { computeSecurityDepositSettlement } from './security-deposits';

describe('computeSecurityDepositSettlement', () => {
	it('refunds in full when there is no damage', () => {
		expect(
			computeSecurityDepositSettlement({ heldCentavos: 300_000, folioBalanceCentavos: 0 })
		).toEqual({ forfeitedCentavos: 0, refundedCentavos: 300_000 });
	});

	it('forfeits the damage amount and refunds the rest', () => {
		expect(
			computeSecurityDepositSettlement({ heldCentavos: 300_000, folioBalanceCentavos: 120_000 })
		).toEqual({ forfeitedCentavos: 120_000, refundedCentavos: 180_000 });
	});

	it('forfeits everything and refunds nothing when damage equals the hold', () => {
		expect(
			computeSecurityDepositSettlement({ heldCentavos: 300_000, folioBalanceCentavos: 300_000 })
		).toEqual({ forfeitedCentavos: 300_000, refundedCentavos: 0 });
	});

	it('caps the forfeit at the held amount when damage exceeds it', () => {
		expect(
			computeSecurityDepositSettlement({ heldCentavos: 300_000, folioBalanceCentavos: 500_000 })
		).toEqual({ forfeitedCentavos: 300_000, refundedCentavos: 0 });
	});

	it('clamps a negative/credit folio balance to zero forfeited', () => {
		expect(
			computeSecurityDepositSettlement({ heldCentavos: 300_000, folioBalanceCentavos: -50_000 })
		).toEqual({ forfeitedCentavos: 0, refundedCentavos: 300_000 });
	});
});
