import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { roleCan } from '$lib/authz';
import {
	DocumentError,
	getLiquidationRegister,
	listDocumentSeries,
	spoilSerial
} from '$lib/server/finance/documents';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotelId = locals.hotel!.id;
	const series = await listDocumentSeries(hotelId);

	const requested = url.searchParams.get('series');
	const selected = series.find((s) => s.id === requested) ?? series.find((s) => s.status === 'active') ?? series[0];
	const register = selected ? await getLiquidationRegister(hotelId, selected.id) : null;

	const canWrite =
		(locals.user?.isPlatformAdmin ?? false) ||
		(locals.role ? roleCan(locals.role, 'finance:write') : false);

	return { series, selectedId: selected?.id ?? null, register, canWrite };
};

export const actions: Actions = {
	spoil: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'finance:write');
		const parsed = z
			.object({
				type: z.enum(['invoice', 'official_receipt']),
				reason: z.string().trim().min(3).max(400)
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Enter a reason (3+ characters).' });

		try {
			const row = await spoilSerial(
				event.locals.hotel!.id,
				parsed.data.type,
				parsed.data.reason,
				event.locals.user ?? null
			);
			return { ok: `Serial ${row.formattedNo} recorded as spoiled.` };
		} catch (e) {
			if (e instanceof DocumentError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
