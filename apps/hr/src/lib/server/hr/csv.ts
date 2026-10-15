/** One CSV file: header + rows, quoted where needed, with a BOM so Excel opens it as UTF-8. */
export function toCsv(head: string[], rows: Array<Array<string | number | null | undefined>>): string {
	const cell = (v: string | number | null | undefined) => {
		const s = v === null || v === undefined ? '' : String(v);
		return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
	};
	return '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Centavos as a plain decimal for a spreadsheet (no currency symbol, no thousands separator). */
export const pesos = (centavos: number) => (centavos / 100).toFixed(2);
