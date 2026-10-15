import { requireCap } from '$lib/server/auth/rbac';
import { writeAudit } from '$lib/server/audit';
import { toCsv } from '$lib/server/finance/calc';
import { getPaymentReconciliation, parseReconciliationFilter } from '$lib/server/finance/payment-reconciliation';
import type { RequestHandler } from './$types';

const pesos = (c: number) => (c / 100).toFixed(2);
/** Guest-typed text opened in a spreadsheet must never run as a formula (=, +, -, @ at the start). */
const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const FOUND_BY: Record<string, string> = {
	guest_page: 'Guest confirmation page',
	worker: 'Every-minute check',
	webhook: 'Webhook-prompted check',
	hold_sweep: 'Booking-hold sweep',
	backfill: 'Imported'
};

/** The Reconciliation tab's settled list (current filters) as a spreadsheet, with every identifier and the trail fingerprints. */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const filter = parseReconciliationFilter(url);
	const { settled, integrity } = await getPaymentReconciliation(hotel.id, hotel.timezone, filter);
	const when = (d: Date | null) =>
		d
			? new Intl.DateTimeFormat('en-CA', { timeZone: hotel.timezone, dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(d)
			: '';
	const csv = toCsv(
		[
			'Trail #',
			'Reconciled at',
			'Paid at PayMongo',
			'Guest started checkout',
			'Missing for (seconds)',
			'Found by',
			'Type',
			'Booking / dining',
			'Guest',
			'Amount received',
			'Amount asked',
			'Amount matches',
			'Paid after cancel',
			'Booking status before',
			'Booking status after',
			'Times checked',
			'PayMongo payment ID',
			'Payment intent',
			'Checkout session',
			'Our payment record',
			'Check code',
			'Entry fingerprint',
			'Previous fingerprint'
		],
		settled.map((s) => [
			String(s.seq),
			when(s.reconciledAt),
			when(s.paymongoPaidAt),
			when(s.attemptStartedAt),
			s.missingMs == null ? '' : String(Math.round(s.missingMs / 1000)),
			FOUND_BY[s.trigger] ?? s.trigger,
			s.scope === 'room' ? 'Booking' : 'Dining',
			s.orderCode,
			safe(s.guestName ?? ''),
			pesos(s.amountCentavos),
			s.expectedAmountCentavos == null ? '' : pesos(s.expectedAmountCentavos),
			s.expectedAmountCentavos == null ? '' : s.amountMismatch ? 'NO' : 'yes',
			s.paidAfterCancel ? 'YES' : '',
			s.orderStatusBefore ?? '',
			s.orderStatusAfter ?? '',
			s.checks == null ? '' : String(s.checks),
			s.paymongoPaymentId,
			s.paymentIntentId ?? '',
			s.checkoutSessionId ?? '',
			s.paymentRowId ?? '',
			s.attemptCode ?? '',
			s.rowHash,
			s.prevHash ?? ''
		])
	);

	// Who took a copy of the money records, and when, is itself part of the trail.
	await writeAudit({
		hotelId: hotel.id,
		actor: locals.user,
		action: 'reconciliation.exported',
		entityType: 'payment_reconciliation',
		after: { rows: settled.length, from: filter.from ?? null, to: filter.to ?? null, scope: filter.scope, trailIntact: integrity.ok, headSeq: integrity.headSeq }
	}).catch((e) => console.error('could not audit the reconciliation export', e));

	return new Response(csv, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="payment-reconciliation.csv"`,
			'cache-control': 'no-store'
		}
	});
};
