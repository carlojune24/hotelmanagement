import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { roleCan } from '$lib/authz';
import { FinanceError, businessDateFor } from '$lib/server/finance/shared';
import { getDayCloseStatus, listDayCloses } from '$lib/server/finance/dayclose';
import { getXReading, issueZReading, listZReadings } from '$lib/server/finance/readings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;

	const xDate = url.searchParams.get('date') || businessDateFor(hotel.timezone);
	const [xReading, zReadings, dayCloses] = await Promise.all([
		getXReading(hotel.id, xDate),
		listZReadings(hotel.id),
		listDayCloses(hotel.id, 30)
	]);

	const zDates = new Set(zReadings.map((z) => z.businessDate));
	const closedWithoutZ = dayCloses
		.filter((d) => !d.reopenedAt && !zDates.has(d.businessDate))
		.map((d) => d.businessDate);

	const canGenerate =
		(locals.user?.isPlatformAdmin ?? false) ||
		(locals.role ? roleCan(locals.role, 'dayclose:run') : false);

	return { xReading, xDate, zReadings, closedWithoutZ, canGenerate };
};

export const actions: Actions = {
	generateZ: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dayclose:run');
		const parsed = z
			.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Invalid date.' });

		const status = await getDayCloseStatus(event.locals.hotel!.id, parsed.data.date);
		if (!status.closed) {
			return fail(400, { error: `${parsed.data.date} must be closed before a Z-reading can be issued.` });
		}
		try {
			const row = await issueZReading(
				event.locals.hotel!.id,
				parsed.data.date,
				status.row?.id ?? null,
				event.locals.user ?? null
			);
			return { ok: `Z-reading No. ${row.zCounter} issued for ${parsed.data.date}.` };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
