import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { businessDateFor, FinanceError } from '$lib/server/finance/shared';
import { listExpenseCategories, listVendors } from '$lib/server/finance/accounts';
import { createRestock, listStock, StockError } from '$lib/server/stock';
import { saveUpload, UploadValidationError } from '$lib/server/uploads';
import { toMilli } from '$lib/stock-units';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'inventory:write');
	const hotel = locals.hotel!;
	const [stock, vendors, categories] = await Promise.all([listStock(hotel.id), listVendors(hotel.id), listExpenseCategories(hotel.id)]);
	const items = stock.filter((i) => i.isActive).map((i) => ({ id: i.id, name: i.name, unit: i.unit, department: i.department }));
	// `?item=` (repeatable) pre-fills lines — from a Stock row or a Shopping list supplier group.
	const wanted = new Set(url.searchParams.getAll('item'));
	return {
		items,
		vendors: vendors.map((v) => ({ id: v.id, name: v.name })),
		categories: categories.map((c) => ({ id: c.id, name: c.name })),
		today: businessDateFor(hotel.timezone),
		presets: items.filter((i) => wanted.has(i.id)).map((i) => i.id),
		vatRateBps: hotel.vatRateBps || 1200 // supplier VAT even when the hotel isn't VAT-registered; same fallback as Expenses
	};
};

const lineSchema = z.object({
	itemId: z.string().uuid(),
	qty: z.number().positive().finite(),
	unit: z.string(),
	expiresOn: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional()
});

export const actions: Actions = {
	default: async ({ locals, request, params }) => {
		requireCap(locals.user, locals.role, 'inventory:write');
		const hotel = locals.hotel!;
		const fd = await request.formData();
		const p = z
			.object({
				receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
				vendor: z.string().max(200).optional(),
				receiptNo: z.string().max(120).optional(),
				total: z.coerce.number().positive().finite(),
				isVatable: z.literal('on').optional(),
				categoryId: z.string().uuid(),
				source: z.enum(['hotel', 'dining']),
				note: z.string().max(500).optional(),
				lines: z.string()
			})
			.safeParse(Object.fromEntries(fd));
		if (!p.success) {
			const field = p.error.issues[0]?.path[0];
			const msg: Record<string, string> = {
				total: 'Enter the receipt total.',
				categoryId: 'Pick the expense category.',
				receiptDate: 'Enter the receipt date.'
			};
			return fail(400, { error: msg[String(field)] ?? 'Check the receipt details.' });
		}
		const d = p.data;

		let lines: z.infer<typeof lineSchema>[];
		try {
			lines = z.array(lineSchema).parse(JSON.parse(d.lines));
		} catch {
			return fail(400, { error: 'Check the item quantities.' });
		}
		const units = new Map((await listStock(hotel.id)).map((i) => [i.id, i.unit]));
		const converted = lines.map((l) => ({ itemId: l.itemId, qtyMilli: units.has(l.itemId) ? toMilli(l.qty, l.unit, units.get(l.itemId)!) : null, expiresOn: l.expiresOn || null }));
		if (converted.some((l) => !l.qtyMilli || l.qtyMilli <= 0)) return fail(400, { error: 'Check the item quantities and units.' });

		let attachmentUrl: string | null = null;
		const file = fd.get('attachment');
		if (file instanceof File && file.size > 0) {
			try {
				attachmentUrl = await saveUpload(hotel.id, file, 'image');
			} catch (e) {
				if (e instanceof UploadValidationError) return fail(400, { error: e.message });
				throw e;
			}
		}

		// Same rule as Expenses: a typed name that matches a saved vendor links to it.
		const vendorText = d.vendor?.trim() ?? '';
		const saved = vendorText ? (await listVendors(hotel.id)).find((v) => v.name.toLowerCase() === vendorText.toLowerCase()) : undefined;

		let id: string;
		try {
			id = await createRestock({
				hotelId: hotel.id,
				receiptDate: d.receiptDate,
				vendorId: saved?.id ?? null,
				vendorName: saved ? null : vendorText || null,
				receiptNo: d.receiptNo ?? null,
				totalCentavos: Math.round(d.total * 100),
				isVatable: d.isVatable === 'on',
				categoryId: d.categoryId,
				source: d.source,
				attachmentUrl,
				note: d.note ?? null,
				lines: converted.map((l) => ({ ...l, qtyMilli: l.qtyMilli! })),
				actor: locals.user
			});
		} catch (e) {
			if (e instanceof StockError || e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
		redirect(303, `/${params.hotel}/management/inventory/restock/${id}?saved=1`);
	}
};
