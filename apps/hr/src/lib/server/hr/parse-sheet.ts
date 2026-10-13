import * as XLSX from 'xlsx';
import { parseDelimited } from '$lib/hr-import';

export class ParseSheetError extends Error {}

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Cells of the first sheet / delimited text as trimmed strings, one array per non-empty row. */
export async function parseImportFile(file: File): Promise<string[][]> {
	if (file.size === 0) throw new ParseSheetError('That file is empty.');
	if (file.size > MAX_IMPORT_BYTES) throw new ParseSheetError('That file is over 5 MB.');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const name = file.name.toLowerCase();

	if (/\.(xlsx|xlsm|xls)$/.test(name)) {
		try {
			const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
			const sheet = wb.Sheets[wb.SheetNames[0]!];
			if (!sheet) throw new ParseSheetError('That workbook has no sheets.');
			const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
				header: 1,
				raw: false,
				blankrows: false,
				dateNF: 'yyyy-mm-dd hh:mm:ss'
			});
			return rows
				.map((r) => (r as unknown[]).map((c) => (c === null || c === undefined ? '' : String(c).trim())))
				.filter((r) => r.some((c) => c !== ''));
		} catch (e) {
			if (e instanceof ParseSheetError) throw e;
			throw new ParseSheetError('Could not read that spreadsheet.');
		}
	}

	// Text exports (ATTLOG.TXT, CSV). Some reader software writes UTF-16.
	const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
	const text = new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(bytes);
	const rows = parseDelimited(text);
	if (rows.length === 0) throw new ParseSheetError('That file has no rows.');
	return rows;
}
