import { requireCap } from '$lib/server/auth/rbac';
import { getBirSettings } from '$lib/server/finance/documents';
import { listExpenses, parseExpenseFilter } from '$lib/server/finance/expenses';
import { localParts } from '$lib/dining-slots';
import type { DocCell, ReportDoc } from '$lib/dining-report-doc';
import type { PageServerLoad } from './$types';

const SOURCE_LABEL = { hotel: 'Hotel', dining: 'Dining' } as const;

/** The Expenses list as a printable sheet: same filters as the list, every matching expense. */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const f = parseExpenseFilter(url);
	const [rows, bir] = await Promise.all([listExpenses(hotel.id, { ...f, limit: 10_000 }), getBirSettings(hotel.id)]);

	// Voided expenses are listed (so the sheet matches the screen) but never counted.
	const counted = rows.filter((r) => r.status !== 'void');
	const sum = (pick: (r: (typeof rows)[number]) => number, of = counted) => of.reduce((s, r) => s + pick(r), 0);
	const bySource = (src: 'hotel' | 'dining') => sum((r) => r.grossCentavos, counted.filter((r) => r.source === src));

	const meta: [string, string][] = [['Source', f.source ? SOURCE_LABEL[f.source] : 'Hotel and dining']];
	if (f.status) meta.push(['Status', f.status]);

	const doc: ReportDoc = {
		title: f.source ? `${SOURCE_LABEL[f.source]} expenses` : 'Expenses',
		period: f.from || f.to ? `${f.from ?? 'start'} to ${f.to ?? 'today'}` : 'All dates',
		meta,
		summary: [
			...(f.source
				? []
				: [
						{ label: 'Hotel', value: bySource('hotel'), kind: 'money' as const },
						{ label: 'Dining', value: bySource('dining'), kind: 'money' as const }
					]),
			{ label: 'Total (gross)', value: sum((r) => r.grossCentavos), kind: 'money' },
			{ label: 'Input VAT', value: sum((r) => r.inputVatCentavos), kind: 'money' },
			{ label: 'Expenses', value: counted.length, kind: 'int' }
		],
		sections: [
			{
				title: 'Expenses',
				columns: [
					{ label: 'Date', kind: 'text' },
					{ label: 'Source', kind: 'text' },
					{ label: 'Category', kind: 'text' },
					{ label: 'Vendor', kind: 'text' },
					{ label: 'Description', kind: 'text' },
					{ label: 'Status', kind: 'text' },
					{ label: 'Gross', kind: 'money' },
					{ label: 'Input VAT', kind: 'money' }
				],
				rows: rows.map((r): DocCell[] => [
					r.expenseDate,
					SOURCE_LABEL[r.source],
					r.categoryName,
					r.vendorName ?? '',
					`${r.description}${r.vendorInvoiceNo ? ` (#${r.vendorInvoiceNo})` : ''}`,
					r.status,
					r.grossCentavos,
					r.inputVatCentavos
				]),
				total: ['Total', '', '', '', '', '', sum((r) => r.grossCentavos), sum((r) => r.inputVatCentavos)],
				emptyText: 'No expenses match this filter.'
			}
		],
		notes: ['Voided expenses are listed but not included in the totals.']
	};

	const now = localParts(new Date(), hotel.timezone);
	return {
		doc,
		hotelName: hotel.name,
		hotelTin: bir?.tin ?? null,
		printedAt: `${now.date} ${now.time}`,
		preparedBy: locals.user?.name ?? ''
	};
};
