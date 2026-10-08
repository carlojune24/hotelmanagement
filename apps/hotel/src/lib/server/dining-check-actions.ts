import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from './auth/rbac';
import { recordId } from '../rate-validation';
import { FinanceError } from './finance/shared';
import { OrderError } from './dining-orders';
import { closeCheck, settleCheck } from './dining-checks';

/**
 * Form actions for settling and closing a table, shared by the Floor and the Orders board
 * (both show the same Settle dialog). Each page exposes them as `settle` and `closeTable`.
 */

const businessError = (e: unknown) => e instanceof OrderError || e instanceof FinanceError;
const toCentavos = (php: number) => Math.round(php * 100);

export async function settleTableAction(event: RequestEvent) {
	requireCap(event.locals.user, event.locals.role, 'dining:write');
	const parsed = z
		.object({
			checkId: recordId(),
			method: z.enum(['cash', 'card', 'gcash', 'maya', 'room']),
			tendered: z.coerce.number().min(0).max(10_000_000).optional(),
			bookingId: z.string().uuid().optional().or(z.literal('').transform(() => undefined))
		})
		.safeParse(Object.fromEntries(await event.request.formData()));
	if (!parsed.success) return fail(400, { error: 'Check the payment details.' });
	try {
		const r = await settleCheck({
			hotelId: event.locals.hotel!.id,
			checkId: parsed.data.checkId,
			method: parsed.data.method,
			tenderedCentavos: parsed.data.tendered != null ? toCentavos(parsed.data.tendered) : null,
			bookingId: parsed.data.bookingId ?? null,
			actor: event.locals.user
		});
		return {
			ok: r.closed
				? 'Paid. The table is free again.'
				: r.paidCount > 0
					? 'Paid. The table stays open until everything is served.'
					: 'Nothing was left to pay.',
			settled: { change: r.changeCentavos, closed: r.closed }
		};
	} catch (e) {
		if (businessError(e)) return fail(400, { error: (e as Error).message });
		throw e;
	}
}

export async function closeTableAction(event: RequestEvent) {
	requireCap(event.locals.user, event.locals.role, 'dining:write');
	const parsed = z.object({ checkId: recordId() }).safeParse(Object.fromEntries(await event.request.formData()));
	if (!parsed.success) return fail(400, { error: 'That table could not be found.' });
	try {
		await closeCheck({ hotelId: event.locals.hotel!.id, checkId: parsed.data.checkId, actor: event.locals.user });
		return { ok: 'The table is free again.' };
	} catch (e) {
		if (businessError(e)) return fail(400, { error: (e as Error).message });
		throw e;
	}
}
