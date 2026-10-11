import { toCsv } from './finance/calc';
import type { BookingTransactionExportRow } from './booking-transactions';

const php = (centavos: number) => (centavos / 100).toFixed(2);

/**
 * A spreadsheet treats a cell that starts with = + - or @ as a formula, and guest names and
 * payment references are typed by strangers. Prefix those with an apostrophe so they stay text.
 */
export function safeCell(value: string): string {
	return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const STATUS: Record<BookingTransactionExportRow['status'], string> = {
	confirmed: 'Confirmed',
	in_house: 'In house',
	checked_out: 'Checked out',
	cancelled: 'Cancelled'
};

export const BOOKING_TRANSACTION_HEADERS = [
	'Booking code',
	'Booked on',
	'Guest',
	'Email',
	'Rooms / events',
	'Check-in',
	'Check-out',
	'Status',
	'Source',
	'Payment method',
	'Reference no.',
	'Charges',
	'Paid',
	'Balance',
	'Security deposit'
];

/**
 * The booking transactions register as a CSV: one row per booking, then a totals row. The leading
 * UTF-8 byte-order mark is what lets Excel read ₱-free but accented guest names correctly.
 */
export function bookingTransactionsCsv(rows: BookingTransactionExportRow[]): string {
	const body = rows.map((r) => [
		r.code,
		r.createdAt.slice(0, 10),
		safeCell(r.guestName),
		safeCell(r.guestEmail),
		safeCell(r.roomLabel),
		r.checkIn,
		r.checkOut,
		STATUS[r.status] + (r.cancelledCount > 0 && r.status !== 'cancelled' ? ` (${r.cancelledCount} cancelled)` : ''),
		r.source,
		r.methods.join(', '),
		safeCell(r.references.join(', ')),
		php(r.chargesCentavos),
		php(r.paidCentavos),
		php(r.balanceCentavos),
		r.depositCentavos > 0 ? php(r.depositCentavos) : ''
	]);
	const sum = (pick: (r: BookingTransactionExportRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
	const totals = [
		'Total',
		'',
		`${rows.length} booking${rows.length === 1 ? '' : 's'}`,
		'', '', '', '', '', '', '', '',
		php(sum((r) => r.chargesCentavos)),
		php(sum((r) => r.paidCentavos)),
		php(sum((r) => Math.max(0, r.balanceCentavos))),
		php(sum((r) => r.depositCentavos))
	];
	return '\uFEFF' + toCsv(BOOKING_TRANSACTION_HEADERS, [...body, totals]);
}
