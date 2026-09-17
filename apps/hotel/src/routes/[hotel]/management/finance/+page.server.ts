import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from '$lib/server/auth/rbac';
import { businessDateFor, FinanceError } from '$lib/server/finance/shared';
import { getCashPosition } from '$lib/server/finance/cash';
import {
	daySnapshot,
	getDayCloseStatus,
	reopenDayClose,
	runDayClose
} from '$lib/server/finance/dayclose';
import {
	cashflowReport,
	dailyCashflowReport,
	expenseReport,
	paymentMethodBreakdown,
	revenueBySourceReport
} from '$lib/server/finance/reports';
import { listReceivables } from '$lib/server/finance/receivables';
import { listShifts } from '$lib/server/finance/shifts';
import { listExpenses } from '$lib/server/finance/expenses';
import { addDays, rangeLabel, sanitizeRange } from '$lib/finance-range';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const today = businessDateFor(hotel.timezone);
	const { from, to } = sanitizeRange(
		url.searchParams.get('from'),
		url.searchParams.get('to'),
		today
	);

	const [
		position,
		cashflow,
		dailyFlow,
		revenue,
		expenses,
		methodMix,
		drafts,
		receivablesActive,
		shifts,
		dayClose,
		todaySnap
	] = await Promise.all([
		getCashPosition(hotel.id), // balances as of now — range-independent
		cashflowReport(hotel.id, from, to),
		dailyCashflowReport(hotel.id, from, to),
		revenueBySourceReport(hotel.id, from, to),
		expenseReport(hotel.id, from, to),
		paymentMethodBreakdown(hotel.id, from, to),
		listExpenses(hotel.id, { status: 'draft', limit: 200 }),
		listReceivables(hotel.id, { status: 'active' }),
		listShifts(hotel.id, 100),
		getDayCloseStatus(hotel.id, today),
		daySnapshot(hotel.id, today)
	]);

	// Dense per-day series for the chart (fill the days with no movement).
	const byDate = new Map(dailyFlow.map((d) => [d.date, d]));
	const dailySeries: { date: string; inCentavos: number; outCentavos: number }[] = [];
	for (let d = from; d <= to; d = addDays(d, 1)) {
		dailySeries.push(byDate.get(d) ?? { date: d, inCentavos: 0, outCentavos: 0 });
		if (dailySeries.length > 400) break; // sanitizeRange caps at 366; belt-and-braces
	}

	return {
		today,
		range: { from, to, label: rangeLabel(from, to, today) },

		// Balances — as of now
		position,
		totalCashCentavos: position.reduce((s, a) => s + a.closingCentavos, 0),
		arOutstandingCentavos: receivablesActive.reduce((s, r) => s + r.outstandingCentavos, 0),
		arCount: receivablesActive.length,

		// Activity — selected range
		cashInCentavos: cashflow.totalInCentavos,
		cashOutCentavos: cashflow.totalOutCentavos,
		cashflowRows: cashflow.rows,
		dailySeries,
		revenue,
		expenses,
		methodMix,

		// Needs attention + day close (today)
		draftExpenseCount: drafts.length,
		draftExpenseTotalCentavos: drafts.reduce((s, e) => s + e.grossCentavos, 0),
		openShifts: shifts.filter((s) => s.status === 'open'),
		dayClose,
		todayNetCentavos: todaySnap.netCentavos
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
