import { error, fail, redirect } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { discardCount, finishCount, getCount, saveCount, StockError, type CountEntry } from '$lib/server/stock';
import { COUNT_UNIT } from '$lib/stock-units';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const found = await getCount(locals.hotel!.id, params.id);
	if (!found) error(404, 'Count not found');
	return { ...found, timezone: locals.hotel!.timezone };
};

/**
 * The sheet posts one `itemId` / `counted` / `reason` triple per line. `counted` is in the line's
 * count unit (kg, L or pcs); blank = not counted yet. Only the count's own items are kept.
 */
async function readEntries(event: RequestEvent): Promise<CountEntry[] | null> {
	const found = await getCount(event.locals.hotel!.id, event.params.id);
	if (!found) return null;
	const units = new Map(found.lines.map((l) => [l.itemId, l.unit]));
	const form = await event.request.formData();
	const ids = form.getAll('itemId').map(String);
	const counted = form.getAll('counted').map(String);
	const reasons = form.getAll('reason').map(String);
	const entries: CountEntry[] = [];
	for (const [i, itemId] of ids.entries()) {
		const unit = units.get(itemId);
		if (!unit) continue;
		const raw = (counted[i] ?? '').trim();
		const n = raw === '' ? null : Number(raw);
		if (n != null && (!Number.isFinite(n) || n < 0)) throw new StockError('Counts must be zero or more.');
		entries.push({ itemId, countedMilli: n == null ? null : Math.round(n * COUNT_UNIT[unit].milli), reason: (reasons[i] ?? '').slice(0, 300) || null });
	}
	return entries;
}

async function guard<T>(fn: () => Promise<T>) {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof StockError) return fail(400, { error: e.message });
		throw e;
	}
}

export const actions: Actions = {
	save: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'inventory:write');
		return guard(async () => {
			const entries = await readEntries(event);
			if (!entries) return fail(404, { error: 'That count was not found.' });
			await saveCount(event.locals.hotel!.id, event.params.id, entries);
			return { ok: 'Progress saved.' };
		});
	},

	finish: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'inventory:write');
		return guard(async () => {
			const entries = await readEntries(event);
			if (!entries) return fail(404, { error: 'That count was not found.' });
			// Save first, so what was typed is kept even if finishing is refused (a missing reason).
			await saveCount(event.locals.hotel!.id, event.params.id, entries);
			const r = await finishCount(event.locals.hotel!.id, event.params.id, event.locals.user);
			return { ok: r.adjusted ? `Count finished. ${r.adjusted} item${r.adjusted === 1 ? '' : 's'} corrected.` : 'Count finished. Everything matched.' };
		});
	},

	discard: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'inventory:write');
		const r = await guard(() => discardCount(event.locals.hotel!.id, event.params.id, event.locals.user));
		if (r) return r;
		redirect(303, `/${event.params.hotel}/management/inventory/counts`);
	}
};
