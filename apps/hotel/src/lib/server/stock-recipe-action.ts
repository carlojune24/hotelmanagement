import { fail, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { setRecipe, StockError, type RecipeOwner } from '$lib/server/stock';

const linesSchema = z
	.array(z.object({ stockItemId: z.string().uuid(), qtyMilli: z.number().int().positive().max(1e12) }))
	.max(50);

/**
 * `?/saveRecipe` for the dining menu and add-on pages: the form posts `owner` ('menuItemId' |
 * 'addonId'), `ownerId` and `lines` (JSON, quantities already in thousandths of the base unit).
 * The caller has checked the page's own permission (`dining:manage`).
 */
export async function saveRecipeAction(event: RequestEvent) {
	const form = await event.request.formData();
	const ownerId = z.string().uuid().safeParse(form.get('ownerId'));
	const kind = form.get('owner');
	let lines: z.infer<typeof linesSchema>;
	try {
		lines = linesSchema.parse(JSON.parse(String(form.get('lines') ?? '[]')));
	} catch {
		return fail(400, { error: 'Check the ingredient quantities.' });
	}
	if (!ownerId.success || (kind !== 'menuItemId' && kind !== 'addonId')) return fail(400, { error: 'That dish could not be found.' });
	const owner: RecipeOwner = kind === 'menuItemId' ? { menuItemId: ownerId.data } : { addonId: ownerId.data };
	try {
		await setRecipe(event.locals.hotel!.id, owner, lines, event.locals.user);
	} catch (e) {
		if (e instanceof StockError) return fail(400, { error: e.message });
		throw e;
	}
	return { ok: lines.length ? 'Ingredients saved. New orders take them from stock.' : 'Ingredients cleared.' };
}
