/**
 * Stock units — pure, safe on client and server. Every stock quantity is stored as integer
 * thousandths of its item's base unit (g, ml or pcs); see `db/schema/stock.ts`.
 */
export type StockBaseUnit = 'g' | 'ml' | 'pcs';

export interface UnitDef {
	key: string;
	label: string;
	/** Thousandths of the base unit in one of this unit. */
	milli: number;
}

/** What a quantity may be entered in, per base unit. oz (weight) and fl oz (volume) are deliberately separate. */
export const UNITS: Record<StockBaseUnit, UnitDef[]> = {
	g: [
		{ key: 'g', label: 'g', milli: 1_000 },
		{ key: 'kg', label: 'kg', milli: 1_000_000 },
		{ key: 'oz', label: 'oz', milli: 28_350 },
		{ key: 'lb', label: 'lb', milli: 453_592 }
	],
	ml: [
		{ key: 'ml', label: 'ml', milli: 1_000 },
		{ key: 'L', label: 'L', milli: 1_000_000 },
		{ key: 'fl_oz', label: 'fl oz', milli: 29_574 },
		{ key: 'tsp', label: 'tsp', milli: 4_929 },
		{ key: 'tbsp', label: 'tbsp', milli: 14_787 },
		{ key: 'cup', label: 'cup', milli: 236_588 },
		{ key: 'gal', label: 'gal', milli: 3_785_412 }
	],
	pcs: [
		{ key: 'pcs', label: 'pcs', milli: 1_000 },
		{ key: 'dozen', label: 'dozen', milli: 12_000 }
	]
};

export const BASE_UNIT_LABELS: Record<StockBaseUnit, string> = {
	g: 'Weight (g, kg, oz, lb)',
	ml: 'Volume (ml, L, fl oz, tsp, cup)',
	pcs: 'Count (pcs, dozen)'
};

/** The unit a shelf count is typed in: whole kg / L read better than grams at a storeroom. */
export const COUNT_UNIT: Record<StockBaseUnit, UnitDef> = {
	g: UNITS.g[1]!,
	ml: UNITS.ml[1]!,
	pcs: UNITS.pcs[0]!
};

/** `value` entered in `unitKey` → integer thousandths of `base`. Null for an unknown unit or a non-finite value. */
export function toMilli(value: number, unitKey: string, base: StockBaseUnit): number | null {
	const unit = UNITS[base].find((u) => u.key === unitKey);
	if (!unit || !Number.isFinite(value)) return null;
	return Math.round(value * unit.milli);
}

/** Human quantity in the item's base unit, stepping up to kg / L once it reaches 1000. */
export function formatQty(milli: number, base: StockBaseUnit): string {
	const n = milli / 1000;
	const big = base === 'g' ? 'kg' : base === 'ml' ? 'L' : null;
	if (big && Math.abs(n) >= 1000) return `${fmt(n / 1000)} ${big}`;
	return `${fmt(n)} ${base}`;
}

function fmt(n: number): string {
	return n.toLocaleString('en-PH', { maximumFractionDigits: 3 });
}
