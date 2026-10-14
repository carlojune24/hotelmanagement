/** Pure rules for pay items: what a line takes from them. No database here, so payroll and tests share it. */

export type PayItemKind = 'earning' | 'deduction';
export const EARNING_CATEGORIES = ['allowance', 'incentive', 'other'] as const;
export const DEDUCTION_CATEGORIES = ['cash_advance', 'other'] as const;
export const CATEGORY_LABEL: Record<string, string> = {
	allowance: 'Allowance',
	incentive: 'Incentive',
	cash_advance: 'Cash advance',
	other: 'Other'
};

export interface PayItemLike {
	kind: string;
	category: string;
	amountCentavos: number;
}

/** The four engine inputs the payroll line already knows how to price. */
export interface Buckets {
	allowancesCentavos: number;
	otherEarningsCentavos: number;
	cashAdvanceCentavos: number;
	otherDeductionsCentavos: number;
}

export function bucketsOf(items: PayItemLike[]): Buckets {
	const b: Buckets = { allowancesCentavos: 0, otherEarningsCentavos: 0, cashAdvanceCentavos: 0, otherDeductionsCentavos: 0 };
	for (const i of items) {
		if (i.kind === 'earning') {
			if (i.category === 'allowance') b.allowancesCentavos += i.amountCentavos;
			else b.otherEarningsCentavos += i.amountCentavos; // incentive and other earnings
		} else if (i.category === 'cash_advance') b.cashAdvanceCentavos += i.amountCentavos;
		else b.otherDeductionsCentavos += i.amountCentavos;
	}
	return b;
}

/** A single-cutoff item has `endDate === startDate`; null `endDate` runs until voided. */
export function appliesToCutoff(
	item: { startDate: string; endDate: string | null },
	cutoffStart: string,
	cutoffEnd: string
): boolean {
	return item.startDate <= cutoffEnd && (item.endDate ?? '9999-12-31') >= cutoffStart;
}

export interface LinePayItem {
	id: string;
	kind: string;
	category: string;
	label: string;
	amountCentavos: number;
}
