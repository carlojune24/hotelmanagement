import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { businessDateFor, FinanceError } from '$lib/server/finance/shared';
import { getCashPosition } from '$lib/server/finance/cash';
import { daySnapshot, getDayCloseStatus, runDayClose, reopenDayClose } from '$lib/server/finance/dayclose';
import { revenueBySourceReport } from '$lib/server/finance/reports';
import { listReceivables } from '$lib/server/finance/receivables';
import { listShifts } from '$lib/server/finance/shifts';
import { listExpenses } from '$lib/server/finance/expenses';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const today = businessDateFor(hotel.timezone);
	const monthStart = `${today.slice(0, 7)}-01`;

	const [position, snap, mtd, drafts, receivablesActive, shifts, dayClose] = await Promise.all([
		getCashPosition(hotel.id),
		daySnapshot(hotel.id, today),
		revenueBySourceReport(hotel.id, monthStart, today),
		listExpenses(hotel.id, { status: 'draft', limit: 200 }),
		listReceivables(hotel.id, { status: 'active' }),
		listShifts(hotel.id, 100),
		getDayCloseStatus(hotel.id, today)
	]);

	return {
		today,
		monthStart,
		position,
		totalCashCentavos: position.reduce((s, a) => s + a.closingCentavos, 0),
		snapshot: snap,
		mtdRevenue: mtd,
		draftExpenseCount: drafts.length,
		draftExpenseTotalCentavos: drafts.reduce((s, e) => s + e.grossCentavos, 0),
		arOutstandingCentavos: receivablesActive.reduce((s, r) => s + r.outstandingCentavos, 0),
		arCount: receivablesActive.length,
		openShifts: shifts.filter((s) => s.status === 'open'),
		dayClose
	};
};

export const actions: Actions = {
	dayClose: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dayclose:run');
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({ businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Missing date.' });
		try {
			await runDayClose(hotel.id, parsed.data.businessDate, event.locals.user);
			return { ok: `${parsed.data.businessDate} closed.` };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	},

	dayReopen: async (event) => {
		requireCap(event.locals.user, event.locals.role, 'dayclose:run');
		requireCap(event.locals.user, event.locals.role, 'hotel:admin');
		const hotel = event.locals.hotel!;
		const parsed = z
			.object({ businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
			.safeParse(Object.fromEntries(await event.request.formData()));
		if (!parsed.success) return fail(400, { error: 'Missing date.' });
		try {
			await reopenDayClose(hotel.id, parsed.data.businessDate, event.locals.user);
			return { ok: `${parsed.data.businessDate} reopened.` };
		} catch (e) {
			if (e instanceof FinanceError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
