import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { FinanceError } from '$lib/server/finance/shared';
import { listReceivables } from '$lib/server/finance/receivables';
import { recordOtaPayout } from '$lib/server/finance/ota';
import { listOtaChannels } from '$lib/server/ota-channels';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotelId = locals.hotel!.id;
	const [rows, channels] = await Promise.all([
		listReceivables(hotelId, { status: 'active', ota: 'only' }),
		listOtaChannels(hotelId)
	]);
	// One tab per OTA: every active one, plus any switched-off OTA that still has bookings waiting.
	const waiting = new Set(rows.map((r) => r.ota?.name));
	const tabs = channels.filter((c) => c.isActive || waiting.has(c.name)).map((c) => c.name);
	return { rows, tabs };
};

export const actions: Actions = {
	record: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'receivable:write');
		const parsed = z
			.object({
				statementRef: z.string().trim().min(1).max(120),
				itemsJson: z.string()
			})
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: "Enter the OTA's statement reference." });
		let items: { receivableId: string; netReceivedCentavos: number }[];
		try {
			items = z
				.array(z.object({ receivableId: z.string().uuid(), netReceivedCentavos: z.number().int().positive() }))
				.min(1)
				.parse(JSON.parse(parsed.data.itemsJson));
		} catch {
			return fail(400, { error: 'Tick at least one booking and enter the amount received for each.' });
		}
		try {
			const r = await recordOtaPayout({
				hotelId: event.locals.hotel!.id,
				statementRef: parsed.data.statementRef,
				items,
				actor: event.locals.user
			});
			const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
			return { ok: `Payout recorded: ${peso(r.collectedCentavos)} received, ${peso(r.commissionCentavos)} commission.` };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
