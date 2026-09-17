import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { SecurityDepositError, listSecurityDeposits, voidSecurityDeposit } from '$lib/server/security-deposits';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const show = url.searchParams.get('show');
	const status = show === 'held' || show === 'settled' || show === 'voided' ? show : undefined;

	const rows = await listSecurityDeposits(hotel.id, { status });
	return { rows, show: status ?? 'all' };
};

export const actions: Actions = {
	void: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'booking:write');
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({ id: z.string().uuid(), reason: z.string().min(1).max(300) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'A void needs a reason.' });

		try {
			await voidSecurityDeposit(hotel.id, parsed.data.id, parsed.data.reason, event.locals.user);
			return { ok: 'Deposit voided.' };
		} catch (e) {
			if (e instanceof SecurityDepositError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
