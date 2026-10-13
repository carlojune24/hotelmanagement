import { describe, expect, it } from 'vitest';
import {
	computePagibig2026,
	computePayrollLine,
	computePhilhealth2026,
	computeSss2026,
	computeWithholdingTax,
	dayKindOf,
	sssMonthlySalaryCredit,
	withholdingTable,
	type PayrollDayInput
} from './index';

const peso = (n: number) => Math.round(n * 100);

describe('SSS', () => {
	it('rounds compensation to the nearest ₱500 and clamps to ₱5,000–₱35,000', () => {
		expect(sssMonthlySalaryCredit(peso(3_000))).toBe(peso(5_000));
		expect(sssMonthlySalaryCredit(peso(5_249.99))).toBe(peso(5_000));
		expect(sssMonthlySalaryCredit(peso(5_250))).toBe(peso(5_500));
		expect(sssMonthlySalaryCredit(peso(5_749.99))).toBe(peso(5_500));
		expect(sssMonthlySalaryCredit(peso(5_750))).toBe(peso(6_000));
		expect(sssMonthlySalaryCredit(peso(34_749.99))).toBe(peso(34_500));
		expect(sssMonthlySalaryCredit(peso(34_750))).toBe(peso(35_000));
		expect(sssMonthlySalaryCredit(peso(250_000))).toBe(peso(35_000));
	});
	it('is 5% employee, 10% employer, and EC ₱10 below ₱15,000 MSC else ₱30', () => {
		expect(computeSss2026(peso(5_000))).toEqual({ employeeShare: peso(250), employerShare: peso(500), ec: peso(10) });
		expect(computeSss2026(peso(14_700))).toEqual({ employeeShare: peso(725), employerShare: peso(1_450), ec: peso(10) });
		expect(computeSss2026(peso(15_000))).toEqual({ employeeShare: peso(750), employerShare: peso(1_500), ec: peso(30) });
		expect(computeSss2026(peso(80_000))).toEqual({ employeeShare: peso(1_750), employerShare: peso(3_500), ec: peso(30) });
	});
});

describe('PhilHealth', () => {
	it('is 5% split equally, floored at ₱10,000 and capped at ₱100,000', () => {
		expect(computePhilhealth2026(peso(5_000))).toEqual({ employeeShare: peso(250), employerShare: peso(250) });
		expect(computePhilhealth2026(peso(10_000))).toEqual({ employeeShare: peso(250), employerShare: peso(250) });
		expect(computePhilhealth2026(peso(50_000))).toEqual({ employeeShare: peso(1_250), employerShare: peso(1_250) });
		expect(computePhilhealth2026(peso(150_000))).toEqual({ employeeShare: peso(2_500), employerShare: peso(2_500) });
	});
	it('never loses a centavo to the split', () => {
		const c = computePhilhealth2026(peso(10_000.01));
		expect(c.employeeShare + c.employerShare).toBe(Math.round(peso(10_000.01) * 0.05));
	});
});

describe('Pag-IBIG', () => {
	it('is 2%/2% capped at a ₱10,000 fund salary (max ₱200)', () => {
		expect(computePagibig2026(peso(5_000))).toEqual({ employeeShare: peso(100), employerShare: peso(100) });
		expect(computePagibig2026(peso(10_000))).toEqual({ employeeShare: peso(200), employerShare: peso(200) });
		expect(computePagibig2026(peso(60_000))).toEqual({ employeeShare: peso(200), employerShare: peso(200) });
	});
	it('is 1% employee / 2% employer at ₱1,500 and below', () => {
		expect(computePagibig2026(peso(1_000))).toEqual({ employeeShare: peso(10), employerShare: peso(20) });
		expect(computePagibig2026(peso(1_500))).toEqual({ employeeShare: peso(15), employerShare: peso(30) });
		expect(computePagibig2026(peso(1_500.01)).employeeShare).toBe(peso(30.0)); // 2% of 1,500.01
	});
});

describe('BIR withholding (TRAIN)', () => {
	it('builds the published monthly table', () => {
		const t = withholdingTable('monthly');
		expect(t.map((b) => b.over)).toEqual([0, 20_833, 33_333, 66_667, 166_667, 666_667]);
		expect(t.map((b) => b.base)).toEqual([0, 0, 1_875, 8_541.8, 33_541.8, 183_541.8]);
		expect(t.map((b) => b.rate)).toEqual([0, 0.15, 0.2, 0.25, 0.3, 0.35]);
	});
	it('builds the published semi-monthly table', () => {
		const t = withholdingTable('semi_monthly');
		expect(t.map((b) => b.over)).toEqual([0, 10_417, 16_667, 33_333, 83_333, 333_333]);
		expect(t.map((b) => b.base)).toEqual([0, 0, 937.5, 4_270.7, 16_770.7, 91_770.7]);
	});
	it('withholds nothing up to the first bound and 15% of the excess above it', () => {
		expect(computeWithholdingTax(peso(20_833), 'monthly')).toBe(0);
		expect(computeWithholdingTax(peso(25_000), 'monthly')).toBe(peso(625.05));
		expect(computeWithholdingTax(peso(15_000), 'semi_monthly')).toBe(peso(687.45));
	});
	it('applies the higher brackets', () => {
		expect(computeWithholdingTax(peso(40_000), 'monthly')).toBe(peso(3_208.4)); // 1,875 + 20% of 6,667
		expect(computeWithholdingTax(peso(100_000), 'monthly')).toBe(peso(16_875.05)); // 8,541.80 + 25% of 33,333
	});
});

describe('premium day kinds', () => {
	it('classifies rest days and holidays', () => {
		expect(dayKindOf({ isRestDay: false, holiday: null })).toBe('ordinary');
		expect(dayKindOf({ isRestDay: true, holiday: null })).toBe('rest_day');
		expect(dayKindOf({ isRestDay: false, holiday: 'regular_holiday' })).toBe('regular_holiday');
		expect(dayKindOf({ isRestDay: true, holiday: 'regular_holiday' })).toBe('regular_holiday_rest');
		expect(dayKindOf({ isRestDay: false, holiday: 'special_holiday' })).toBe('special_holiday');
		expect(dayKindOf({ isRestDay: false, holiday: 'local_holiday' })).toBe('special_holiday');
		expect(dayKindOf({ isRestDay: false, holiday: 'memo' })).toBe('ordinary');
	});
});

const day = (over: Partial<PayrollDayInput> = {}): PayrollDayInput => ({
	date: '2026-03-02',
	dayKind: 'ordinary',
	scheduledWorkday: true,
	workedMinutes: 480,
	creditMinutes: 0,
	otMinutes: 0,
	unapprovedOtMinutes: 0,
	nightDiffMinutes: 0,
	tardinessMinutes: 0,
	undertimeMinutes: 0,
	punched: true,
	...over
});

const base = {
	personRef: 'per_TEST',
	costCenter: null,
	frequency: 'semi_monthly' as const,
	dayFactor: 313,
	nightDiffRate: 0.1
};

describe('computePayrollLine', () => {
	it('refuses to compute without a working-day factor', () => {
		expect(() =>
			computePayrollLine({ ...base, dayFactor: 0, payBasis: 'monthly', baseRateCentavos: peso(20_000), days: [] })
		).toThrow(/working-day factor/);
	});

	it('monthly-paid: half the month, nothing deducted for a full attendance', () => {
		const { line } = computePayrollLine({
			...base,
			payBasis: 'monthly',
			baseRateCentavos: peso(20_000),
			days: Array.from({ length: 13 }, () => day())
		});
		expect(line.earnings.basic).toBe(peso(10_000));
		expect(line.gross).toBe(peso(10_000));
		// statutory on the ₱20,000 monthly rate, half per period
		expect(line.deductions.sss_ee).toBe(peso(500)); // MSC 20,000 × 5% = 1,000, half per period
		expect(line.deductions.philhealth_ee).toBe(peso(250)); // 5% × 20,000 = 1,000, EE half = 500, half per period
		expect(line.deductions.pagibig_ee).toBe(peso(100)); // capped at 10,000 × 2% = 200, half per period
	});

	it('monthly-paid: an absence costs a day at the monthly rate × 12 ÷ factor, lateness costs by the minute', () => {
		const days = [day({ workedMinutes: 0 }), day({ tardinessMinutes: 30, undertimeMinutes: 30 }), day()];
		const { line, detail } = computePayrollLine({
			...base,
			payBasis: 'monthly',
			baseRateCentavos: peso(20_000),
			days
		});
		expect(detail.dailyRateCentavos).toBe(Math.round((peso(20_000) * 12) / 313));
		expect(detail.absentDays).toBe(1);
		expect(line.earnings.basic).toBe(peso(10_000) - detail.dailyRateCentavos);
		expect(line.deductions.tardiness_undertime).toBe(Math.round((60 / 60) * detail.hourlyRateCentavos));
	});

	it('daily-paid: paid for the time worked, no separate lateness deduction', () => {
		const { line } = computePayrollLine({
			...base,
			payBasis: 'daily',
			baseRateCentavos: peso(600),
			days: [day(), day(), day({ workedMinutes: 240, tardinessMinutes: 240 })]
		});
		expect(line.earnings.basic).toBe(peso(600 * 2.5)); // 480 + 480 + 240 minutes = 2.5 days
		expect(line.deductions.tardiness_undertime).toBe(0);
	});

	it('hourly-paid: rate × hours', () => {
		const { line } = computePayrollLine({
			...base,
			payBasis: 'hourly',
			baseRateCentavos: peso(100),
			days: [day({ workedMinutes: 450 })]
		});
		expect(line.earnings.basic).toBe(peso(750)); // 7.5 h
	});

	it('pays approved overtime at 125% and never pays unapproved overtime', () => {
		const { line } = computePayrollLine({
			...base,
			payBasis: 'hourly',
			baseRateCentavos: peso(100),
			// 8h regular + 60 approved OT + 30 unapproved, all inside workedMinutes
			days: [day({ workedMinutes: 480 + 60 + 30, otMinutes: 60, unapprovedOtMinutes: 30 })]
		});
		expect(line.earnings.basic).toBe(peso(800));
		expect(line.earnings.overtime).toBe(peso(125));
		expect(line.hours_ot).toBe(1);
		expect(line.gross).toBe(peso(925));
	});

	it('adds the regular-holiday premium on hours actually worked, not on credit', () => {
		const worked = computePayrollLine({
			...base,
			payBasis: 'hourly',
			baseRateCentavos: peso(100),
			days: [day({ dayKind: 'regular_holiday' })]
		});
		expect(worked.line.earnings.basic).toBe(peso(800));
		expect(worked.line.earnings.holiday_premium).toBe(peso(800)); // +100% of 8 h
		const credited = computePayrollLine({
			...base,
			payBasis: 'hourly',
			baseRateCentavos: peso(100),
			days: [day({ dayKind: 'regular_holiday', punched: false, creditMinutes: 480 })]
		});
		expect(credited.line.earnings.holiday_premium).toBe(0);
	});

	it('pays a special holiday at +30% and a rest day at +30%', () => {
		const sp = computePayrollLine({
			...base, payBasis: 'hourly', baseRateCentavos: peso(100),
			days: [day({ dayKind: 'special_holiday' })]
		});
		expect(sp.line.earnings.holiday_premium).toBe(peso(240));
		const rest = computePayrollLine({
			...base, payBasis: 'hourly', baseRateCentavos: peso(100),
			days: [day({ dayKind: 'rest_day', scheduledWorkday: false })]
		});
		expect(rest.line.earnings.holiday_premium).toBe(peso(240));
	});

	it('uses the rest-day/holiday overtime multipliers', () => {
		const { line } = computePayrollLine({
			...base, payBasis: 'hourly', baseRateCentavos: peso(100),
			days: [day({ dayKind: 'regular_holiday', workedMinutes: 540, otMinutes: 60 })]
		});
		expect(line.earnings.overtime).toBe(peso(260)); // 1 h × 100 × 2.6
	});

	it('pays night differential at 10% of the hourly rate', () => {
		const { line } = computePayrollLine({
			...base, payBasis: 'hourly', baseRateCentavos: peso(100),
			days: [day({ nightDiffMinutes: 120 })]
		});
		expect(line.earnings.night_diff).toBe(peso(20)); // 2 h × 100 × 10%
	});

	it('takes withholding on gross less the employee contributions, and lets it be overridden', () => {
		const input = {
			...base,
			payBasis: 'monthly' as const,
			baseRateCentavos: peso(60_000),
			days: Array.from({ length: 13 }, () => day())
		};
		const { line, detail } = computePayrollLine(input);
		const ee = line.deductions.sss_ee + line.deductions.philhealth_ee + line.deductions.pagibig_ee;
		expect(detail.taxableCentavos).toBe(line.gross - ee);
		expect(line.deductions.withholding_tax).toBe(computeWithholdingTax(line.gross - ee, 'semi_monthly'));
		expect(line.deductions.withholding_tax).toBeGreaterThan(0);

		const exempt = computePayrollLine({ ...input, exemptFromWithholding: true });
		expect(exempt.line.deductions.withholding_tax).toBe(0);
		const overridden = computePayrollLine({
			...input,
			adjustments: {
				allowancesCentavos: 0, otherEarningsCentavos: 0, cashAdvanceCentavos: 0,
				loansCentavos: 0, otherDeductionsCentavos: 0, withholdingOverrideCentavos: peso(1_234.56)
			}
		});
		expect(overridden.line.deductions.withholding_tax).toBe(peso(1_234.56));
	});

	it('always adds up: net = gross − every deduction', () => {
		const { line } = computePayrollLine({
			...base,
			payBasis: 'monthly',
			baseRateCentavos: peso(35_000),
			days: [day(), day({ workedMinutes: 0 }), day({ nightDiffMinutes: 90, otMinutes: 45, workedMinutes: 525 })],
			adjustments: {
				allowancesCentavos: peso(500), otherEarningsCentavos: peso(100), cashAdvanceCentavos: peso(300),
				loansCentavos: peso(200), otherDeductionsCentavos: peso(50), withholdingOverrideCentavos: null
			}
		});
		const earn = Object.values(line.earnings).reduce((a, b) => a + b, 0);
		const ded = Object.values(line.deductions).reduce((a, b) => a + b, 0);
		expect(line.gross).toBe(earn);
		expect(line.net_pay).toBe(earn - ded);
	});

	it('a person with no pay this cutoff owes no contributions', () => {
		const { line } = computePayrollLine({
			...base, payBasis: 'daily', baseRateCentavos: peso(600), days: [day({ workedMinutes: 0 })]
		});
		expect(line.gross).toBe(0);
		expect(line.deductions.sss_ee).toBe(0);
		expect(line.net_pay).toBe(0);
	});

	it('accrues a twelfth of basic for the 13th month, on basic only', () => {
		const { line } = computePayrollLine({
			...base, payBasis: 'monthly', baseRateCentavos: peso(24_000),
			days: Array.from({ length: 13 }, () => day({ otMinutes: 60, workedMinutes: 540 })),
			adjustments: {
				allowancesCentavos: peso(1_000), otherEarningsCentavos: 0, cashAdvanceCentavos: 0,
				loansCentavos: 0, otherDeductionsCentavos: 0, withholdingOverrideCentavos: null
			}
		});
		expect(line.thirteenth_month_accrual).toBe(peso(1_000)); // 12,000 basic ÷ 12
	});

	it('splits a month evenly when paid monthly (no halving)', () => {
		const m = computePayrollLine({
			...base, frequency: 'monthly', payBasis: 'monthly', baseRateCentavos: peso(20_000),
			days: Array.from({ length: 26 }, () => day())
		});
		expect(m.line.earnings.basic).toBe(peso(20_000));
		expect(m.line.deductions.sss_ee).toBe(peso(1_000));
	});
});
