import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { listCounts, startCount, StockError } from '$lib/server/stock';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return { counts: await listCounts(locals.hotel!.id), timezone: locals.hotel!.timezone };
};

export const actions: Actions = {
	start: async ({ locals, request, params }) => {
		requireCap(locals.user, locals.role, 'inventory:write');
		const p = z
			.object({ department: z.enum(['all', 'dining', 'front_desk', 'housekeeping']), note: z.string().max(300).optional() })
			.safeParse(Object.fromEntries(await request.formData()));
		if (!p.success) return fail(400, { error: 'Pick what to count.' });
		let id: string;
		try {
			id = await startCount(locals.hotel!.id, p.data.department === 'all' ? null : p.data.department, p.data.note ?? null, locals.user);
		} catch (e) {
			if (e instanceof StockError) return fail(400, { error: e.message });
			throw e;
		}
		redirect(303, `/${params.hotel}/management/inventory/counts/${id}`);
	}
};
