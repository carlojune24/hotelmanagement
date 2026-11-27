import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { correctCount, listStock, receiveStock, removeStock, StockError } from '$lib/server/stock';
import { toMilli } from '$lib/stock-units';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return { stock: await listStock(locals.hotel!.id) };
};

const num = z.coerce.number().finite();
const optInt = z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().min(0).max(100000).optional());

/** The item the form names, so a quantity is converted with that item's own base unit. */
async function itemFor(hotelId: string, itemId: unknown) {
	const id = z.string().uuid().safeParse(itemId);
	if (!id.success) return null;
	return (await listStock(hotelId)).find((r) => r.id === id.data) ?? null;
}

async function run(fn: () => Promise<unknown>, ok: string) {
	try {
		await fn();
		return { ok };
	} catch (e) {
		if (e instanceof StockError) return fail(400, { error: e.message });
		throw e;
	}
}

export const actions: Actions = {
	receive: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'inventory:write');
		const hotelId = locals.hotel!.id;
		const f = Object.fromEntries(await request.formData());
		const item = await itemFor(hotelId, f.itemId);
		if (!item) return fail(404, { error: 'That item could not be found.' });

		const p = z
			.object({
				mode: z.enum(['qty', 'packs']),
				qty: num.optional(),
				unit: z.string(),
				packCount: optInt,
				packBonus: optInt,
				packSize: num.optional(),
				expiresOn: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
				note: z.string().max(300).optional()
			})
			.safeParse(f);
		if (!p.success) return fail(400, { error: 'Check the quantity.' });
		const d = p.data;

		let qtyMilli: number | null;
		let pack: { packCount: number; packBonus: number; packSizeMilli: number } | null = null;
		if (d.mode === 'packs') {
			const size = toMilli(d.packSize ?? NaN, d.unit, item.unit);
			if (!size || size <= 0 || !d.packCount) return fail(400, { error: 'Enter how many packs, and how much is in one.' });
			pack = { packCount: d.packCount, packBonus: d.packBonus ?? 0, packSizeMilli: size };
			qtyMilli = (pack.packCount + pack.packBonus) * size;
		} else {
			qtyMilli = toMilli(d.qty ?? NaN, d.unit, item.unit);
		}
		if (!qtyMilli || qtyMilli <= 0) return fail(400, { error: 'Enter a quantity above zero.' });

		return run(
			() => receiveStock({ hotelId, itemId: item.id, qtyMilli: qtyMilli!, expiresOn: d.expiresOn || null, ...pack, note: d.note, actor: locals.user }),
			`${item.name} received.`
		);
	},

	remove: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'inventory:write');
		const hotelId = locals.hotel!.id;
		const f = Object.fromEntries(await request.formData());
		const item = await itemFor(hotelId, f.itemId);
		if (!item) return fail(404, { error: 'That item could not be found.' });
		const p = z.object({ qty: num, unit: z.string(), note: z.string().max(300).optional() }).safeParse(f);
		const qtyMilli = p.success ? toMilli(p.data.qty, p.data.unit, item.unit) : null;
		if (!p.success || !qtyMilli || qtyMilli <= 0) return fail(400, { error: 'Enter a quantity above zero.' });
		return run(
			() => removeStock({ hotelId, itemId: item.id, qtyMilli, type: 'waste', note: p.data.note ?? null, actor: locals.user }),
			`Waste recorded for ${item.name}.`
		);
	},

	count: async ({ locals, request }) => {
		requireCap(locals.user, locals.role, 'inventory:write');
		const hotelId = locals.hotel!.id;
		const f = Object.fromEntries(await request.formData());
		const item = await itemFor(hotelId, f.itemId);
		if (!item) return fail(404, { error: 'That item could not be found.' });
		const p = z.object({ qty: num, unit: z.string(), note: z.string().max(300).optional() }).safeParse(f);
		const counted = p.success ? toMilli(p.data.qty, p.data.unit, item.unit) : null;
		if (!p.success || counted == null || counted < 0) return fail(400, { error: 'Enter what you counted (zero or more).' });
		return run(
			() => correctCount({ hotelId, itemId: item.id, countedMilli: counted, note: p.data.note ?? null, actor: locals.user }),
			`${item.name} count corrected.`
		);
	}
};
