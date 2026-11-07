import { requireCap } from '$lib/server/auth/rbac';
import { toCsv } from '$lib/server/finance/calc';
import { listExpenses, parseExpenseFilter } from '$lib/server/finance/expenses';
import type { RequestHandler } from './$types';

const pesos = (c: number) => (c / 100).toFixed(2);

/** The Expenses list's current filters (source, status, dates) as a spreadsheet. */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const f = parseExpenseFilter(url);
	const rows = await listExpenses(hotel.id, { ...f, limit: 10_000 });

	const csv = toCsv(
		['Date', 'Source', 'Category', 'Vendor', 'Description', 'Vendor invoice / OR', 'Gross', 'Input VAT', 'Net of VAT', 'Withholding tax', 'Status'],
		rows.map((r) => [
			r.expenseDate,
			r.source === 'dining' ? 'Dining' : 'Hotel',
			r.categoryName,
			r.vendorName ?? '',
			r.description,
			r.vendorInvoiceNo ?? '',
			pesos(r.grossCentavos),
			pesos(r.inputVatCentavos),
			pesos(r.netOfVatCentavos),
			pesos(r.withholdingTaxCentavos),
			r.status
		])
	);
	const name = ['expenses', f.source, f.from, f.to].filter(Boolean).join('-');
	return new Response(csv, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${name}.csv"`
		}
	});
};
