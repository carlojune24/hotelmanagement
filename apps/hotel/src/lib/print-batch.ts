/**
 * Client-safe pieces of "choose the document at payment": what staff can pick, what came back,
 * and the link that prints several documents in one job. The server issues; this only names things.
 */

/** What to issue when an order is paid. `default` keeps the hotel's own auto-OR setting. */
export type PayDocuments = 'default' | 'or' | 'none' | 'invoice';
/**
 * What the cashier can pick in the dialogs, in the order they are shown. `bill` issues no OR or
 * invoice at all: it only prints the plain bill (the server stores it as `none`).
 */
export type DocumentChoice = 'or' | 'invoice' | 'bill';

/** The server-side meaning of a dialog choice. */
export const toPayDocuments = (c: DocumentChoice | 'none'): Exclude<PayDocuments, 'default'> => (c === 'bill' || c === 'none' ? 'none' : c);

export interface IssuedDocument {
	id: string;
	type: 'official_receipt' | 'invoice';
	formattedNo: string;
	/** The order it belongs to, so a table's list can say which order each one is. */
	orderCode?: string;
}

export interface BillTo {
	name?: string | null;
	address?: string | null;
	tin?: string | null;
}

export const DOCUMENT_CHOICE_LABEL: Record<DocumentChoice, string> = {
	or: 'Official Receipt',
	invoice: 'Invoice',
	bill: 'Normal Bill'
};

export const DOCUMENT_TYPE_LABEL: Record<IssuedDocument['type'], string> = {
	official_receipt: 'Receipt',
	invoice: 'Invoice'
};

/**
 * Padding inside one receipt (top, right, bottom, left) so the text stays within what a thermal head can
 * actually print. An 80mm roll such as the Vozy G80 prints about 72mm (576 dots) and starts a couple of
 * mm in from the left edge, so the right side needs more room than the left or the last characters of every
 * right-aligned figure are cut off. Every thermal print (OR, invoice, bill, sale receipt) uses this one value.
 */
export const thermalPadding = (widthMm: number) => (widthMm === 58 ? '3mm 5mm 3mm 3mm' : '3mm 8mm 3mm 4mm');

/** `/{slug}/print/batch?ids=a,b&auto=1`: one print job for every document. */
export function batchPrintHref(slug: string, ids: string[], opts: { auto?: boolean; /** The thermal receipt unless A4 is asked for. */ format?: 'thermal' | 'a4' } = {}): string {
	const q = new URLSearchParams({ ids: ids.join(',') });
	if (opts.auto) q.set('auto', '1');
	if (opts.format === 'a4') q.set('format', 'a4');
	return `/${slug}/print/batch?${q.toString()}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ids in a batch link, de-duplicated, valid ones only, capped so a link can't ask for hundreds. */
export function parseBatchIds(raw: string | null, max = 40): string[] {
	const ids = (raw ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter((s) => UUID.test(s));
	return [...new Set(ids)].slice(0, max);
}
