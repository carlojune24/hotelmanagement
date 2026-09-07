import { and, eq, gte, lte, lt } from 'drizzle-orm';
import { db } from './db/index';
import {
	dailyRates,
	functionHalls,
	hotels,
	ratePlans,
	seasonalRates,
	taxesFees,
	type TaxFee
} from './db/schema/index';

/** Calendar dates `[checkIn, checkOut)` as `YYYY-MM-DD` strings, one per night. */
export function nightsBetween(checkIn: string, checkOut: string): string[] {
	const nights: string[] = [];
	const cursor = new Date(`${checkIn}T00:00:00Z`);
	const end = new Date(`${checkOut}T00:00:00Z`);
	while (cursor < end) {
		nights.push(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return nights;
}

export interface NightlyPrice {
	date: string;
	priceCentavos: number;
}

/** Plan-level inputs the nightly-rate resolver needs. */
export interface NightlyRateInputs {
	basePriceCentavos: number;
	weekendPriceCentavos: number | null;
	/** JS `getUTCDay()` values (0 = Sun … 6 = Sat) that price at the weekend rate. */
	weekendDays: number[];
}

/** One seasonal date range as the resolver consumes it. Bounds are inclusive. */
export interface SeasonalRange {
	startDate: string;
	endDate: string;
	priceCentavos: number | null;
	multiplierBps: number | null;
}

/**
 * Pure nightly-rate resolution, in precedence order per night:
 *  1. exact `daily_rates` override for that date
 *  2. seasonal range covering the date — absolute price, or a multiplier on (3)
 *  3. weekend rate if the night falls on a `weekendDays` weekday, else base rate
 *
 * Extracted so it can be unit-tested without a database.
 */
export function resolveNightlyRates(
	nights: string[],
	inputs: NightlyRateInputs,
	dailyOverrides: Map<string, number>,
	seasonal: SeasonalRange[]
): NightlyPrice[] {
	return nights.map((date) => {
		const exact = dailyOverrides.get(date);
		if (exact != null) return { date, priceCentavos: exact };

		const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
		const baseline =
			inputs.weekendDays.includes(dow) && inputs.weekendPriceCentavos != null
				? inputs.weekendPriceCentavos
				: inputs.basePriceCentavos;

		const season = seasonal.find((s) => date >= s.startDate && date <= s.endDate);
		if (season) {
			if (season.priceCentavos != null) return { date, priceCentavos: season.priceCentavos };
			if (season.multiplierBps != null) {
				return { date, priceCentavos: Math.round((baseline * season.multiplierBps) / 10000) };
			}
		}
		return { date, priceCentavos: baseline };
	});
}

export interface FeeLine {
	name: string;
	amountCentavos: number;
}

export interface PriceBreakdown {
	nights: NightlyPrice[];
	subtotalCentavos: number;
	fees: FeeLine[];
	vatCentavos: number;
	totalCentavos: number;
}

/**
 * Applies a hotel's active `taxesFees` + VAT to a subtotal already computed by
 * the caller. `periodAmounts` drives `appliesTo: 'per_night'` fixed-fee
 * unit-counting and percentage-per-period rounding — for a room stay this is
 * each night's price; for an hourly function-hall booking (no "night" concept)
 * this is a single-item array `[subtotalCentavos]`, which makes `per_night`
 * fees degrade to applying exactly once, same as `per_stay`.
 *
 * Shared by `priceStay` and `priceEventHall` — each product line computes its
 * own fees/VAT independently; an order combining a room and a hall sums two
 * already-taxed lines rather than re-deriving one combined bill (see
 * `orders.ts`'s doc comment for why this is an accepted v1 simplification).
 */
export function computeFeesAndVat(params: {
	subtotalCentavos: number;
	periodAmounts: number[];
	activeFees: TaxFee[];
	vatRateBps: number;
}): { fees: FeeLine[]; vatCentavos: number; totalCentavos: number } {
	const { subtotalCentavos, periodAmounts, activeFees, vatRateBps } = params;

	const fees: FeeLine[] = activeFees.map((f) => {
		if (f.type === 'fixed') {
			const units = f.appliesTo === 'per_night' ? periodAmounts.length : 1;
			return { name: f.name, amountCentavos: (f.valueCentavos ?? 0) * units };
		}
		// Percentage: per_night rounds each period's share individually before summing;
		// per_stay rounds once against the subtotal. Both approximate the same rate.
		const amountCentavos =
			f.appliesTo === 'per_night'
				? periodAmounts.reduce(
						(sum, p) => sum + Math.round((p * (f.valueBps ?? 0)) / 10000),
						0
					)
				: Math.round((subtotalCentavos * (f.valueBps ?? 0)) / 10000);
		return { name: f.name, amountCentavos };
	});
	const feesTotalCentavos = fees.reduce((sum, f) => sum + f.amountCentavos, 0);

	const vatCentavos = Math.round(((subtotalCentavos + feesTotalCentavos) * vatRateBps) / 10000);

	return { fees, vatCentavos, totalCentavos: subtotalCentavos + feesTotalCentavos + vatCentavos };
}

/** Bill builder: nightly rates (with per-date overrides) + fees + VAT → total, in centavos. */
export async function priceStay(params: {
	hotelId: string;
	ratePlanId: string;
	checkIn: string;
	checkOut: string;
}): Promise<PriceBreakdown> {
	const { hotelId, ratePlanId, checkIn, checkOut } = params;
	if (checkIn >= checkOut) throw new Error('checkOut must be after checkIn');

	const [hotel] = await db.select().from(hotels).where(eq(hotels.id, hotelId)).limit(1);
	if (!hotel) throw new Error('Hotel not found');

	const [ratePlan] = await db
		.select()
		.from(ratePlans)
		.where(and(eq(ratePlans.id, ratePlanId), eq(ratePlans.hotelId, hotelId)))
		.limit(1);
	if (!ratePlan) throw new Error('Rate plan not found');

	const nightDates = nightsBetween(checkIn, checkOut);
	const lastNight = nightDates[nightDates.length - 1]!;

	const overrides = await db
		.select({ date: dailyRates.date, priceCentavos: dailyRates.priceCentavos })
		.from(dailyRates)
		.where(
			and(
				eq(dailyRates.ratePlanId, ratePlanId),
				gte(dailyRates.date, checkIn),
				lt(dailyRates.date, checkOut)
			)
		);
	const overrideByDate = new Map(overrides.map((o) => [o.date, o.priceCentavos]));

	// Any seasonal range that overlaps [checkIn, lastNight].
	const seasons = await db
		.select({
			startDate: seasonalRates.startDate,
			endDate: seasonalRates.endDate,
			priceCentavos: seasonalRates.priceCentavos,
			multiplierBps: seasonalRates.multiplierBps
		})
		.from(seasonalRates)
		.where(
			and(
				eq(seasonalRates.ratePlanId, ratePlanId),
				lte(seasonalRates.startDate, lastNight),
				gte(seasonalRates.endDate, checkIn)
			)
		)
		.orderBy(seasonalRates.startDate);

	const nights = resolveNightlyRates(
		nightDates,
		{
			basePriceCentavos: ratePlan.basePriceCentavos,
			weekendPriceCentavos: ratePlan.weekendPriceCentavos,
			weekendDays: ratePlan.weekendDays
		},
		overrideByDate,
		seasons
	);
	const subtotalCentavos = nights.reduce((sum, n) => sum + n.priceCentavos, 0);

	const activeFees = await db
		.select()
		.from(taxesFees)
		.where(and(eq(taxesFees.hotelId, hotelId), eq(taxesFees.isActive, true)));

	const { fees, vatCentavos, totalCentavos } = computeFeesAndVat({
		subtotalCentavos,
		periodAmounts: nights.map((n) => n.priceCentavos),
		activeFees,
		vatRateBps: hotel.vatRateBps
	});

	return { nights, subtotalCentavos, fees, vatCentavos, totalCentavos };
}

function toMinutes(hhmm: string): number {
	const [h, m] = hhmm.split(':').map(Number);
	return (h ?? 0) * 60 + (m ?? 0);
}

export interface HallPriceBreakdown {
	hours: number;
	baseHours: number;
	extraHours: number;
	basePriceCentavos: number;
	extraHourFeeCentavos: number;
	extraHoursCostCentavos: number;
	subtotalCentavos: number;
	fees: FeeLine[];
	vatCentavos: number;
	totalCentavos: number;
}

/**
 * Bill builder for an hourly function-hall rental: base block + extra-hour
 * rate + fees/VAT. `startTime`/`endTime` are `"HH:MM"` strings — callers must
 * Zod-validate their format before calling; this function only checks that
 * the resulting duration is positive.
 */
export async function priceEventHall(params: {
	hotelId: string;
	functionHallId: string;
	startTime: string;
	endTime: string;
}): Promise<HallPriceBreakdown> {
	const { hotelId, functionHallId, startTime, endTime } = params;
	const hours = (toMinutes(endTime) - toMinutes(startTime)) / 60;
	if (!(hours > 0)) throw new Error('endTime must be after startTime');

	const [hotel] = await db.select().from(hotels).where(eq(hotels.id, hotelId)).limit(1);
	if (!hotel) throw new Error('Hotel not found');

	const [hall] = await db
		.select()
		.from(functionHalls)
		.where(and(eq(functionHalls.id, functionHallId), eq(functionHalls.hotelId, hotelId)))
		.limit(1);
	if (!hall) throw new Error('Function hall not found');

	const extraHours = Math.max(0, hours - hall.baseHours);
	const extraHoursCostCentavos = Math.round(extraHours * hall.extraHourFeeCentavos);
	const subtotalCentavos = hall.basePriceCentavos + extraHoursCostCentavos;

	const activeFees = await db
		.select()
		.from(taxesFees)
		.where(and(eq(taxesFees.hotelId, hotelId), eq(taxesFees.isActive, true)));

	const { fees, vatCentavos, totalCentavos } = computeFeesAndVat({
		subtotalCentavos,
		periodAmounts: [subtotalCentavos],
		activeFees,
		vatRateBps: hotel.vatRateBps
	});

	return {
		hours,
		baseHours: hall.baseHours,
		extraHours,
		basePriceCentavos: hall.basePriceCentavos,
		extraHourFeeCentavos: hall.extraHourFeeCentavos,
		extraHoursCostCentavos,
		subtotalCentavos,
		fees,
		vatCentavos,
		totalCentavos
	};
}
