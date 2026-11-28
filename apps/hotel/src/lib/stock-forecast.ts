/**
 * Stock forecasting maths — pure, so it is tested on exact numbers. Quantities are thousandths
 * of the item's base unit (see `stock-units.ts`). No ML: an average of real use, honest about
 * how little history it has.
 */
import type { StockBaseUnit } from './stock-units';

/** Days of history the average looks back over. */
export const WINDOW_DAYS = 28;
/** Fewer stocked days than this and the average is not trusted ("not enough history yet"). */
export const MIN_HISTORY_DAYS = 7;
/** Used when an item has no lead time / cover set of its own. */
export const DEFAULT_LEAD_DAYS = 2;
export const DEFAULT_COVER_DAYS = 14;

export interface DayTotals {
	/** Net change that day (all movement types). */
	net: number;
	/** What was used up that day: orders (net of cancels), check-in kits and waste. */
	used: number;
}

/**
 * Average daily use over the window. A day only counts if the item had stock at its start or was
 * used during it, so days spent at zero (or before it was ever stocked) don't read as "no demand".
 */
export function averageDailyUse(openingMilli: number, days: DayTotals[]): { usedMilli: number; stockedDays: number; avgMilli: number | null } {
	let running = openingMilli;
	let usedMilli = 0;
	let stockedDays = 0;
	for (const d of days) {
		if (running > 0 || d.used > 0) stockedDays++;
		usedMilli += d.used;
		running += d.net;
	}
	return { usedMilli, stockedDays, avgMilli: stockedDays >= MIN_HISTORY_DAYS ? usedMilli / stockedDays : null };
}

export interface ReorderInput {
	onHandMilli: number;
	avgMilli: number | null;
	unit: StockBaseUnit;
	leadDays: number | null;
	coverDays: number | null;
	reorderLevelMilli: number | null;
}

export interface Reorder {
	/** Null = no usage to go by (no history, or nothing used). */
	daysLeft: number | null;
	needsOrder: boolean;
	/** Why it is on the shopping list. */
	reason: 'out' | 'runs_out' | 'low' | null;
	/** What to buy: enough for the lead time plus the cover period, less what is on hand. Null when there is no usage to size it by. */
	suggestedMilli: number | null;
}

/** Rounded up to something a person would buy: whole pieces, or 100 g / 100 ml. */
function buyable(milli: number, unit: StockBaseUnit): number {
	const step = unit === 'pcs' ? 1_000 : 100_000;
	return Math.ceil(milli / step) * step;
}

export function reorder(i: ReorderInput): Reorder {
	const lead = i.leadDays ?? DEFAULT_LEAD_DAYS;
	const cover = i.coverDays ?? DEFAULT_COVER_DAYS;
	const using = i.avgMilli != null && i.avgMilli > 0;
	const daysLeft = using ? Math.max(0, i.onHandMilli) / i.avgMilli! : null;
	const reason: Reorder['reason'] =
		using && i.onHandMilli <= 0 ? 'out' : daysLeft != null && daysLeft <= lead ? 'runs_out' : i.reorderLevelMilli != null && i.onHandMilli <= i.reorderLevelMilli ? 'low' : null;
	const want = using ? i.avgMilli! * (lead + cover) - i.onHandMilli : null;
	return {
		daysLeft,
		needsOrder: reason != null,
		reason,
		suggestedMilli: reason && want != null && want > 0 ? buyable(want, i.unit) : null
	};
}

/** Whole days, rounding down — with a hair of tolerance so 6.9999999 (float division) counts as 7. */
export const wholeDays = (days: number) => Math.floor(days + 1e-9);

/** "≈ 6 days", "< 1 day", or null — rounded on purpose: it is an estimate. */
export function daysLeftLabel(daysLeft: number | null): string | null {
	if (daysLeft == null) return null;
	const d = wholeDays(daysLeft);
	if (d < 1) return '< 1 day left';
	return d > 90 ? '90+ days left' : `≈ ${d} day${d === 1 ? '' : 's'} left`;
}
