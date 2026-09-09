/**
 * Pure money/date helpers for the Finance module — no database, no side effects,
 * so they can be unit-tested in isolation and reused wherever needed.
 */

/** VAT-inclusive input-VAT portion of a gross amount: `gross * rate / (10000 + rate)`
 *  (e.g. 1200 bps → `gross * 12 / 112`). */
export function inputVatOf(grossCentavos: number, vatRateBps: number): number {
	if (vatRateBps <= 0) return 0;
	return Math.round((grossCentavos * vatRateBps) / (10_000 + vatRateBps));
}

/** Expected physical cash in a drawer at shift close. */
export function expectedShiftCash(
	openingFloatCentavos: number,
	cashInCentavos: number,
	cashOutCentavos: number
): number {
	return openingFloatCentavos + cashInCentavos - cashOutCentavos;
}

/** Change owed on a cash tender (never negative — caller rejects a short tender). */
export function changeFor(tenderedCentavos: number, amountCentavos: number): number {
	return Math.max(0, tenderedCentavos - amountCentavos);
}

/** Advance a recurring template's due date by its cadence, pinning monthly-ish
 *  cadences to `anchorDay` (clamped to the target month's length). */
export function advanceDueDate(dateStr: string, cadence: string, anchorDay: number): string {
	const d = new Date(`${dateStr}T00:00:00Z`);
	if (cadence === 'weekly') {
		d.setUTCDate(d.getUTCDate() + 7);
		return d.toISOString().slice(0, 10);
	}
	const step = cadence === 'quarterly' ? 3 : cadence === 'annually' ? 12 : 1;
	// Compute the target month explicitly so a short month can't spill into the next
	// one before the anchor-day clamp runs.
	const targetMonthIndex = d.getUTCMonth() + step;
	const year = d.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
	const month = ((targetMonthIndex % 12) + 12) % 12;
	const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	const day = Math.min(Math.max(1, anchorDay), lastDay);
	return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** RFC-4180-ish CSV from a header row + rows of scalars. */
export function toCsv(headers: (string | number)[], rows: (string | number)[][]): string {
	const esc = (v: string | number) => {
		const s = String(v ?? '');
		return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}
