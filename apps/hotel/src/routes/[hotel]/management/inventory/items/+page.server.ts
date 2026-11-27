import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { createStockItem, listStock, StockError, updateStockItem } from '$lib/server/stock';
import { toMilli } from '$lib/stock-units';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'inventory:manage');
	return { items: await listStock(locals.hotel!.id) };
};

const schema = z.object({
	itemId: z.union([z.literal(''), z.string().uuid()]).optional(),
	name: z.string().trim().min(1, 'Give the item a name.').max(120),
	department: z.enum(['dining', 'front_desk', 'housekeeping']),
	kind: z.enum(['consumable', 'reusable']),
	unit: z.enum(['g', 'ml', 'pcs']),
	reorderQty: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().min(0).finite().optional()),
	reorderUnit: z.string().optional(),
	isActive: z.literal('on').optional()
});

export const actions: Actions = {
	save: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'inventory:manage');
		const hotelId = locals.hotel!.id;
		const p = schema.safeParse(Object.fromEntries(await request.formData()));
		if (!p.success) return fail(400, { error: p.error.issues[0]?.message ?? 'Check the form.' });
		const d = p.data;
		const reorderLevelMilli = d.reorderQty == null ? null : toMilli(d.reorderQty, d.reorderUnit ?? d.unit, d.unit);
		if (d.reorderQty != null && reorderLevelMilli == null) return fail(400, { error: 'Pick a unit for the reorder level.' });
		const input = { name: d.name, department: d.department, kind: d.kind, unit: d.unit, reorderLevelMilli, isActive: d.isActive === 'on' };
		try {
			if (d.itemId) await updateStockItem(hotelId, d.itemId, input, locals.user);
			else await createStockItem(hotelId, input, locals.user);
		} catch (e) {
			if (e instanceof StockError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: d.itemId ? `${d.name} saved.` : `${d.name} added.` };
	}
};
