/**
 * How a booking was made and how far it is paid, in the words staff use. Pure (no database) so the
 * Booking transactions list, its print/CSV and the detail page all say the same thing.
 *
 *  - channel  `online` when the guest booked through the website and paid with PayMongo; `ota` for a
 *             booking keyed in from an OTA (prepaid there, the OTA pays the hotel later); `walkin`
 *             for anything else made at the desk or by staff.
 *  - state    where the money stands against the booking's charges *now* (after any SC/PWD discount).
 */

export type BookingChannel = 'online' | 'walkin' | 'ota';
export type BookingPaymentState = 'paid' | 'downpayment' | 'balance' | 'credit' | 'unpaid' | 'ota_receivable';

export const CHANNEL_LABEL: Record<BookingChannel, string> = { online: 'Online', walkin: 'Walk-in', ota: 'OTA' };

export interface BookingPaymentInput {
	channel: BookingChannel;
	chargesCentavos: number;
	paidCentavos: number;
	/** charges − paid; negative = credit owed to the guest. */
	balanceCentavos: number;
	/** What was paid through PayMongo (not refunds or voids). */
	onlinePaidCentavos: number;
	/** The order total at the time of booking, before any SC/PWD discount. */
	orderTotalCentavos: number;
	/** OTA bookings only: the OTA has not paid the hotel yet (its receivable is still open). */
	otaPayoutPending?: boolean;
}

export interface BookingPaymentSummary {
	state: BookingPaymentState;
	label: string;
	/** Downpayment only: the share of the booking total paid online, as a whole percent. */
	percent: number | null;
}

export function summariseBookingPayment(i: BookingPaymentInput): BookingPaymentSummary {
	if (i.channel === 'ota' && i.otaPayoutPending) {
		return { state: 'ota_receivable', label: 'Awaiting OTA payout', percent: null };
	}
	if (i.balanceCentavos < 0) return { state: 'credit', label: 'Credit owed', percent: null };

	if (i.balanceCentavos === 0) {
		if (i.paidCentavos <= 0) return { state: 'unpaid', label: 'No charges', percent: null };
		const fullOnline = i.channel === 'online' && i.orderTotalCentavos > 0 && i.onlinePaidCentavos >= i.orderTotalCentavos;
		return { state: 'paid', label: fullOnline ? 'Paid in full online' : 'Paid in full', percent: null };
	}

	// Still owing something.
	if (i.paidCentavos <= 0) return { state: 'unpaid', label: 'Unpaid', percent: null };
	if (i.channel === 'online' && i.onlinePaidCentavos > 0 && i.orderTotalCentavos > 0 && i.onlinePaidCentavos < i.orderTotalCentavos) {
		const percent = Math.round((i.onlinePaidCentavos / i.orderTotalCentavos) * 100);
		return { state: 'downpayment', label: `Downpayment ${percent}%`, percent };
	}
	return { state: 'balance', label: 'Balance due', percent: null };
}

/** The filter choices on the list, in the order they are offered. */
export const PAYMENT_FILTERS = [
	{ key: 'all', label: 'Any payment' },
	{ key: 'paid', label: 'Paid in full' },
	{ key: 'downpayment', label: 'Downpayment' },
	{ key: 'balance', label: 'Balance due' },
	{ key: 'credit', label: 'Credit owed' },
	{ key: 'unpaid', label: 'Unpaid' },
	{ key: 'ota_receivable', label: 'Awaiting OTA payout' }
] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number]['key'];

export const SOURCE_FILTERS = [
	{ key: 'all', label: 'All sources' },
	{ key: 'walkin', label: 'Walk-in' },
	{ key: 'online', label: 'Online' },
	{ key: 'ota', label: 'OTA' }
] as const;
export type SourceFilter = (typeof SOURCE_FILTERS)[number]['key'];

export const parsePaymentFilter = (v: string | null | undefined): PaymentFilter =>
	PAYMENT_FILTERS.some((f) => f.key === v) ? (v as PaymentFilter) : 'all';
export const parseSourceFilter = (v: string | null | undefined): SourceFilter =>
	SOURCE_FILTERS.some((f) => f.key === v) ? (v as SourceFilter) : 'all';

export interface TransactionFilters {
	source: SourceFilter;
	pay: PaymentFilter;
	scpwd: boolean;
}

export const NO_FILTERS: TransactionFilters = { source: 'all', pay: 'all', scpwd: false };

/** True when a row passes the filters. Cancelled bookings still pass (they have their own status). */
export function matchesFilters(
	row: { channel: BookingChannel; paymentState: BookingPaymentState; scPwdLabel: string | null },
	f: TransactionFilters
): boolean {
	if (f.source !== 'all' && row.channel !== f.source) return false;
	if (f.pay !== 'all' && row.paymentState !== f.pay) return false;
	if (f.scpwd && !row.scPwdLabel) return false;
	return true;
}

/** The list's filters from a page / CSV / print URL (`?source=online&pay=credit&scpwd=1`). */
export function filtersFromParams(params: URLSearchParams): TransactionFilters {
	return {
		source: parseSourceFilter(params.get('source')),
		pay: parsePaymentFilter(params.get('pay')),
		scpwd: params.get('scpwd') === '1'
	};
}
