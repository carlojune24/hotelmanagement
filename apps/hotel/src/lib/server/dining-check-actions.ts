import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCap } from './auth/rbac';
import { recordId } from '../rate-validation';
import { FinanceError } from './finance/shared';
import { DocumentError } from './finance/documents';
import { chargeDiningOrderToRoom } from './dining-room-charge';
import { OrderError, payDiningOrder, type DiningDiscountChoice } from './dining-orders';
import { REFUND_METHODS, applyDiscountAfterPayment } from './dining-online';
import { roleCan } from '../authz';
import { closeCheck, settleCheck } from './dining-checks';
import { toPayDocuments } from '../print-batch';

/**
 * Form actions for settling and closing a table, shared by the Floor and the Orders board
 * (both show the same Settle dialog). Each page exposes them as `settle` and `closeTable`.
 */

const businessError = (e: unknown) => e instanceof OrderError || e instanceof FinanceError || e instanceof DocumentError;
const PAYMENT_METHODS = ['cash', 'card', 'gcash', 'maya'] as const;
const toCentavos = (php: number) => Math.round(php * 100);

/** The discount fields `discount-fields.svelte` posts; spread into an action's form schema. */
export const discountFields = {
	discountKind: z.enum(['none', 'sc_pwd', 'staff']).default('none'),
	diners: z.coerce.number().int().min(1).max(500).optional(),
	// One per senior / PWD guest, as JSON [{ name, idNumber }] (the dialog builds the list).
	claimants: z
		.string()
		.optional()
		.transform((s, ctx) => {
			try {
				return z
					.array(z.object({ type: z.enum(['senior_citizen', 'pwd']), name: z.string().max(160), idNumber: z.string().max(60) }))
					.max(50)
					.parse(s ? JSON.parse(s) : []);
			} catch {
				ctx.addIssue({ code: 'custom', message: 'bad claimants' });
				return z.NEVER;
			}
		})
};

export function toDiscountChoice(d: {
	discountKind: 'none' | 'sc_pwd' | 'staff';
	claimants?: { type: 'senior_citizen' | 'pwd'; name: string; idNumber: string }[];
	diners?: number;
}): DiningDiscountChoice | null {
	return d.discountKind === 'none' ? null : { kind: d.discountKind, claimants: d.claimants, diners: d.diners };
}

export async function settleTableAction(event: RequestEvent) {
	requireCap(event.locals.user, event.locals.role, 'dining:write');
	const parsed = z
		.object({
			checkId: recordId(),
			method: z.enum(['cash', 'card', 'gcash', 'maya', 'room']),
			tendered: z.coerce.number().min(0).max(10_000_000).optional(),
			referenceNo: z.string().trim().max(80).optional(),
			bookingId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
			// What to issue for each order: an Official Receipt unless the cashier says otherwise.
			documents: z.enum(['or', 'invoice', 'bill', 'none']).default('or'),
			billToName: z.string().trim().max(160).optional(),
			billToAddress: z.string().trim().max(300).optional(),
			billToTin: z.string().trim().max(40).optional(),
			...discountFields
		})
		.safeParse(Object.fromEntries(await event.request.formData()));
	if (!parsed.success) return fail(400, { error: 'Check the payment details.' });
	try {
		const r = await settleCheck({
			hotelId: event.locals.hotel!.id,
			checkId: parsed.data.checkId,
			method: parsed.data.method,
			tenderedCentavos: parsed.data.tendered != null ? toCentavos(parsed.data.tendered) : null,
			referenceNo: parsed.data.referenceNo ?? null,
			bookingId: parsed.data.bookingId ?? null,
			discount: toDiscountChoice(parsed.data),
			documents: toPayDocuments(parsed.data.documents),
			billTo: { name: parsed.data.billToName, address: parsed.data.billToAddress, tin: parsed.data.billToTin },
			actor: event.locals.user
		});
		return {
			ok: r.closed
				? 'Paid. The table is free again.'
				: r.paidCount > 0
					? 'Paid. The table stays open until everything is served.'
					: 'Nothing was left to pay.',
			settled: { change: r.changeCentavos, closed: r.closed, documents: r.documents, documentError: r.documentError }
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

/**
 * A Senior / PWD discount on an order already paid in full; the difference is refunded. Managers only,
 * the same rule as recording a refund (Orders board and Reservations).
 */
export async function discountAfterPaymentAction(event: RequestEvent) {
	const { user, role } = event.locals;
	if (!user?.isPlatformAdmin && !(role && (roleCan(role.capabilities, 'dining:manage') || roleCan(role.capabilities, 'hotel:admin')))) {
		requireCap(user, role, 'dining:manage');
	}
	const parsed = z
		.object({
			orderId: recordId(),
			method: z.enum(REFUND_METHODS),
			referenceNo: z.string().trim().max(80).optional(),
			diners: discountFields.diners,
			claimants: discountFields.claimants
		})
		.safeParse(Object.fromEntries(await event.request.formData()));
	if (!parsed.success) return fail(400, { error: 'Check the guests and how the difference goes back.' });
	const d = parsed.data;
	try {
		const r = await applyDiscountAfterPayment({
			hotelId: event.locals.hotel!.id,
			orderId: d.orderId,
			claimants: d.claimants,
			diners: d.diners ?? d.claimants.length,
			method: d.method,
			referenceNo: d.referenceNo ?? null,
			actor: user
		});
		return { discounted: r };
	} catch (e) {
		if (businessError(e)) return fail(400, { error: (e as Error).message });
		throw e;
	}
}

/** Takes payment for one order: the Take payment dialog on the Orders board and Reservations. */
export async function payOrderAction(event: RequestEvent) {
	requireCap(event.locals.user, event.locals.role, 'dining:write');
	const raw = Object.fromEntries(await event.request.formData());
	const parsed = z
		.object({
			orderId: recordId(),
			method: z.enum(PAYMENT_METHODS),
			tenderedPhp: z.coerce.number().min(0).max(10_000_000).optional(),
			referenceNo: z.string().trim().max(80).optional(),
			// What to issue with the payment: an Official Receipt unless the cashier says otherwise.
			documents: z.enum(['or', 'invoice', 'bill', 'none']).default('or'),
			billToName: z.string().trim().max(160).optional(),
			billToAddress: z.string().trim().max(300).optional(),
			billToTin: z.string().trim().max(40).optional(),
			...discountFields
		})
		.safeParse({ ...raw, tenderedPhp: raw.tenderedPhp === '' ? undefined : raw.tenderedPhp });
	if (!parsed.success) return fail(400, { error: 'Choose how the guest is paying.' });
	const d = parsed.data;
	try {
		const r = await payDiningOrder({
			hotelId: event.locals.hotel!.id,
			orderId: d.orderId,
			method: d.method,
			tenderedCentavos: d.tenderedPhp != null ? toCentavos(d.tenderedPhp) : null,
			referenceNo: d.referenceNo ?? null,
			discount: toDiscountChoice(d),
			documents: toPayDocuments(d.documents),
			billTo: { name: d.billToName, address: d.billToAddress, tin: d.billToTin },
			actor: event.locals.user
		});
		return {
			paid: {
				orderId: d.orderId,
				changeCentavos: r.changeCentavos,
				receiptId: r.receiptId,
				documents: r.documents,
				documentError: r.documentError
			}
		};
	} catch (e) {
		if (businessError(e)) return fail(400, { error: (e as Error).message });
		throw e;
	}
}

/** Charges one order to an in-house guest's room bill (one line on their folio). */
export async function chargeRoomAction(event: RequestEvent) {
	requireCap(event.locals.user, event.locals.role, 'dining:write');
	const parsed = z
		.object({ orderId: recordId(), bookingId: recordId() })
		.safeParse(Object.fromEntries(await event.request.formData()));
	if (!parsed.success) return fail(400, { error: 'Choose the guest to charge.' });
	try {
		const r = await chargeDiningOrderToRoom({
			hotelId: event.locals.hotel!.id,
			orderId: parsed.data.orderId,
			bookingId: parsed.data.bookingId,
			actor: event.locals.user
		});
		return { charged: { orderId: parsed.data.orderId, roomLabel: r.roomLabel, guestName: r.guestName } };
	} catch (e) {
		if (businessError(e)) return fail(400, { error: (e as Error).message });
		throw e;
	}
}
