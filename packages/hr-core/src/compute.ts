import type { PayBasis, PayrollRunLine } from './index';
import { OVERTIME_MULTIPLIER, WORKED_MULTIPLIER, type DayKind } from './premium';
import { computePagibig2026 } from './statutory/pagibig-2026';
import { computePhilhealth2026 } from './statutory/philhealth-2026';
import { computeSss2026 } from './statutory/sss-2026';
import { computeWithholdingTax } from './statutory/bir-train';
import { accrueThirteenthMonth } from './thirteenth-month';

/**
 * One employee's pay for one cutoff, from their saved DTR rows. Pure: no database, no clock.
 * All money is integer centavos; every component is rounded to the centavo as it is computed, so
 * the line always adds up exactly.
 *
 * Simplifications, all deliberate and listed so nobody has to rediscover them:
 * - SSS/PhilHealth/Pag-IBIG are computed on the employee's *rate-based* monthly pay (not on
 *   earned pay), and split equally across the periods of a month.
 * - Night-differential pay = rate × hourly × the day's worked multiplier × night hours; it does not
 *   separate regular from overtime night hours.
 * - Scheduled hours beyond 8 on a day are paid at the straight rate; overtime is only what was
 *   approved past the scheduled end.
 * - Unapproved overtime is not paid.
 * - Withholding is the per-period table; there is no year-end true-up, and a minimum-wage earner's
 *   exemption is applied by `exemptFromWithholding`, not detected.
 */

export interface PayrollDayInput {
	date: string;
	dayKind: DayKind;
	/** Rostered as a working day (not a rest day). */
	scheduledWorkday: boolean;
	/** In → out minus break, including paid-leave / holiday credit and any overtime. */
	workedMinutes: number;
	/** Paid-leave / holiday credit counted inside `workedMinutes`. */
	creditMinutes: number;
	/** Approved overtime, inside `workedMinutes`. */
	otMinutes: number;
	/** Punched past the end with no approved application; inside `workedMinutes`, not paid. */
	unapprovedOtMinutes: number;
	nightDiffMinutes: number;
	tardinessMinutes: number;
	undertimeMinutes: number;
	/** True when the row came from real punches (in and out), not only from leave or credit. */
	punched: boolean;
}

export interface PayrollAdjustments {
	allowancesCentavos: number;
	otherEarningsCentavos: number;
	cashAdvanceCentavos: number;
	loansCentavos: number;
	otherDeductionsCentavos: number;
	/** When set, replaces the computed withholding tax (e.g. a minimum-wage earner, or a correction). */
	withholdingOverrideCentavos: number | null;
}

export const NO_ADJUSTMENTS: PayrollAdjustments = {
	allowancesCentavos: 0,
	otherEarningsCentavos: 0,
	cashAdvanceCentavos: 0,
	loansCentavos: 0,
	otherDeductionsCentavos: 0,
	withholdingOverrideCentavos: null
};

/** Which agencies this person is charged by; absent = covered by all (the default). */
export interface StatutoryCoverage {
	sss: boolean;
	philhealth: boolean;
	pagibig: boolean;
}
export const FULL_COVERAGE: StatutoryCoverage = { sss: true, philhealth: true, pagibig: true };

/** Replaces the monthly salary base a contribution is computed on — never the contribution itself. */
export interface StatutoryBaseOverrides {
	sssCentavos?: number | null;
	philhealthCentavos?: number | null;
	pagibigCentavos?: number | null;
}

/**
 * The rate in force over a stretch of the cutoff (inclusive dates, in order, covering it). A rate that
 * changes inside the cutoff is split by day: each day is paid at the rate of its own segment.
 */
export interface RateSegment {
	start: string;
	end: string;
	/** Per the pay basis unit, which does not change inside a cutoff. */
	baseRateCentavos: number;
}

export interface ComputePayrollLineInput {
	personRef: string;
	costCenter: string | null;
	payBasis: PayBasis;
	/** Per the pay basis unit: a month, a day or an hour. The rate on the cutoff's last day when `rateSegments` is given. */
	baseRateCentavos: number;
	/** Present only when the rate changes inside the cutoff. */
	rateSegments?: RateSegment[];
	frequency: 'semi_monthly' | 'monthly';
	/** Working days a year used to turn a monthly rate into a daily one: 261, 313 or 365. */
	dayFactor: number;
	/** e.g. 0.1 for the statutory 10% night differential. */
	nightDiffRate: number;
	days: PayrollDayInput[];
	adjustments?: PayrollAdjustments;
	exemptFromWithholding?: boolean;
	/** Not covered → that agency's employee *and* employer share (and SSS EC) are zero. */
	coverage?: StatutoryCoverage;
	baseOverrides?: StatutoryBaseOverrides;
}

export interface ComputedPayrollLine {
	line: PayrollRunLine;
	/** Pieces worth showing on a payslip. */
	detail: {
		dailyRateCentavos: number;
		hourlyRateCentavos: number;
		absentDays: number;
		monthlyCompensationCentavos: number;
		taxableCentavos: number;
	};
}

const r = Math.round;

/** The monthly pay a rate stands for, used as the basis for statutory contributions. */
export function monthlyEquivalent(payBasis: PayBasis, rate: number, dayFactor: number): number {
	if (payBasis === 'monthly') return rate;
	if (payBasis === 'daily') return r((rate * dayFactor) / 12);
	return r((rate * 8 * dayFactor) / 12);
}

export function computePayrollLine(input: ComputePayrollLineInput): ComputedPayrollLine {
	if (![261, 313, 365].includes(input.dayFactor)) {
		throw new Error('Choose the working-day factor (261, 313 or 365) before computing payroll.');
	}
	const adj = input.adjustments ?? NO_ADJUSTMENTS;
	const periodsPerMonth = input.frequency === 'semi_monthly' ? 2 : 1;

	const segs = input.rateSegments && input.rateSegments.length > 1 ? input.rateSegments : null;
	const lastRate = segs ? segs[segs.length - 1]!.baseRateCentavos : input.baseRateCentavos;
	const rateAt = (date: string) => {
		if (!segs) return input.baseRateCentavos;
		const hit = segs.find((sg) => date >= sg.start && date <= sg.end);
		return (hit ?? (date < segs[0]!.start ? segs[0]! : segs[segs.length - 1]!)).baseRateCentavos;
	};
	const dailyOf = (rate: number) =>
		input.payBasis === 'monthly'
			? r((rate * 12) / input.dayFactor)
			: input.payBasis === 'daily'
				? rate
				: rate * 8;
	const hourlyOf = (rate: number) => (input.payBasis === 'hourly' ? rate : r(dailyOf(rate) / 8));

	// Statutory contributions follow the rate in force on the cutoff's last day.
	const monthly = monthlyEquivalent(input.payBasis, lastRate, input.dayFactor);
	const daily = dailyOf(lastRate);
	const hourly = hourlyOf(lastRate);

	let regularMinutes = 0; // paid at the straight rate
	let straightPay = 0; // daily/hourly basis: regular minutes at each day's own rate
	let absentPay = 0; // monthly basis: absences at each day's own daily rate
	let latePay = 0;
	let otPay = 0;
	let premiumPay = 0;
	let nightPay = 0;
	let daysWorked = 0;
	let otMinutesTotal = 0;
	let nightMinutesTotal = 0;
	let absentDays = 0;

	for (const d of input.days) {
		const dayRate = rateAt(d.date);
		const dayDaily = dailyOf(dayRate);
		const dayHourly = hourlyOf(dayRate);
		const regular = Math.max(0, d.workedMinutes - d.otMinutes - d.unapprovedOtMinutes);
		regularMinutes += regular;
		if (input.payBasis === 'daily') straightPay += (regular / 480) * dayDaily;
		else if (input.payBasis === 'hourly') straightPay += (regular / 60) * dayHourly;
		if (d.workedMinutes > 0) daysWorked += 1;
		if (d.scheduledWorkday && d.workedMinutes === 0) {
			absentDays += 1;
			absentPay += dayDaily;
		}
		latePay += ((d.tardinessMinutes + d.undertimeMinutes) / 60) * dayHourly;

		otMinutesTotal += d.otMinutes;
		otPay += r((d.otMinutes / 60) * dayHourly * OVERTIME_MULTIPLIER[d.dayKind]);

		// The premium is the excess over straight pay, on hours actually worked (not on credit).
		if (d.punched && d.dayKind !== 'ordinary') {
			const worked = Math.max(0, regular - d.creditMinutes);
			premiumPay += r((Math.min(worked, 480) / 60) * dayHourly * (WORKED_MULTIPLIER[d.dayKind] - 1));
		}

		nightMinutesTotal += d.nightDiffMinutes;
		nightPay += r((d.nightDiffMinutes / 60) * dayHourly * input.nightDiffRate * WORKED_MULTIPLIER[d.dayKind]);
	}

	// ---- basic
	let basic: number;
	let tardinessUndertime = 0;
	if (input.payBasis === 'monthly') {
		// A rate that changes inside the cutoff pays each calendar day of the period at its own rate.
		let period = r(input.baseRateCentavos / periodsPerMonth);
		if (segs) {
			const dayCount = (a: string, b: string) =>
				Math.max(1, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1);
			const total = segs.reduce((t, sg) => t + dayCount(sg.start, sg.end), 0);
			const weighted = segs.reduce((t, sg) => t + sg.baseRateCentavos * dayCount(sg.start, sg.end), 0);
			period = r(weighted / total / periodsPerMonth);
		}
		basic = Math.max(0, period - absentPay);
		tardinessUndertime = r(latePay);
	} else {
		basic = r(straightPay);
	}

	const earnings = {
		basic,
		overtime: otPay,
		holiday_premium: premiumPay,
		night_diff: nightPay,
		allowances: adj.allowancesCentavos,
		other: adj.otherEarningsCentavos
	};
	const gross = Object.values(earnings).reduce((a, b) => a + b, 0);

	// ---- statutory: a month's amount, split across that month's periods
	const pay = gross > 0;
	const cover = input.coverage ?? FULL_COVERAGE;
	const over = input.baseOverrides ?? {};
	const sss =
		pay && cover.sss ? computeSss2026(over.sssCentavos ?? monthly) : { employeeShare: 0, employerShare: 0, ec: 0 };
	const ph =
		pay && cover.philhealth
			? computePhilhealth2026(over.philhealthCentavos ?? monthly)
			: { employeeShare: 0, employerShare: 0 };
	const pi =
		pay && cover.pagibig
			? computePagibig2026(over.pagibigCentavos ?? monthly)
			: { employeeShare: 0, employerShare: 0 };
	const part = (monthlyAmount: number) => r(monthlyAmount / periodsPerMonth);

	const sssEe = part(sss.employeeShare);
	const phEe = part(ph.employeeShare);
	const piEe = part(pi.employeeShare);

	const taxable = Math.max(0, gross - sssEe - phEe - piEe);
	const withholding =
		adj.withholdingOverrideCentavos !== null
			? adj.withholdingOverrideCentavos
			: input.exemptFromWithholding || !pay
				? 0
				: computeWithholdingTax(taxable, input.frequency);

	const deductions = {
		sss_ee: sssEe,
		philhealth_ee: phEe,
		pagibig_ee: piEe,
		withholding_tax: withholding,
		cash_advance: adj.cashAdvanceCentavos,
		loans: adj.loansCentavos,
		tardiness_undertime: tardinessUndertime,
		other: adj.otherDeductionsCentavos
	};
	const totalDeductions = Object.values(deductions).reduce((a, b) => a + b, 0);

	return {
		line: {
			person_ref: input.personRef as PayrollRunLine['person_ref'],
			cost_center: input.costCenter,
			days_worked: daysWorked,
			hours_regular: Math.round((regularMinutes / 60) * 100) / 100,
			hours_ot: Math.round((otMinutesTotal / 60) * 100) / 100,
			hours_night_diff: Math.round((nightMinutesTotal / 60) * 100) / 100,
			earnings,
			gross,
			deductions,
			employer_contributions: {
				sss_er: part(sss.employerShare),
				philhealth_er: part(ph.employerShare),
				pagibig_er: part(pi.employerShare),
				ecc: part(sss.ec)
			},
			net_pay: gross - totalDeductions,
			// Basic actually earned: pay for time not worked (late, undertime) is not part of the 13th-month base.
			thirteenth_month_accrual: accrueThirteenthMonth(basic - tardinessUndertime)
		},
		detail: {
			dailyRateCentavos: daily,
			hourlyRateCentavos: hourly,
			absentDays,
			monthlyCompensationCentavos: monthly,
			taxableCentavos: taxable
		}
	};
}
