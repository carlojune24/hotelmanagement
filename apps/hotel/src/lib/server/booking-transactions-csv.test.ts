import { describe, expect, it } from 'vitest';
import { bookingTransactionsCsv, safeCell } from './booking-transactions-csv';
import type { BookingTransactionExportRow } from './booking-transactions';

const row = (over: Partial<BookingTransactionExportRow> = {}): BookingTransactionExportRow => ({
	orderId: '11111111-2222-3333-4444-555555555555',
	createdAt: '2031-05-20T08:30:00.000Z',
	code: '11111111',
	guestName: 'Ana Reyes',
	guestEmail: 'ana@example.com',
	roomLabel: 'Room 101',
	checkIn: '2031-06-01',
	checkOut: '2031-06-03',
	lineCount: 1,
	status: 'confirmed',
	cancelledCount: 0,
	chargesCentavos: 500_000,
	paidCentavos: 250_000,
	balanceCentavos: 250_000,
	source: 'Online',
	methods: ['paymongo'],
	references: ['pay_abc'],
	depositCentavos: 0,
	channel: 'online',
	paymentState: 'balance',
	paymentLabel: 'Balance due',
	scPwdLabel: null,
	...over
});

/** The CSV with its byte-order mark removed, split into lines. */
const linesOf = (csv: string) => csv.slice(1).split('\r\n');

describe('safeCell', () => {
	it('keeps ordinary text and defuses anything a spreadsheet would run as a formula', () => {
		expect(safeCell('Ana Reyes')).toBe('Ana Reyes');
		expect(safeCell('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`);
		for (const lead of ['+', '-', '@']) expect(safeCell(`${lead}1`)).toBe(`'${lead}1`);
	});
});

describe('bookingTransactionsCsv', () => {
	it('starts with a BOM, has the header, one row per booking, then a totals row', () => {
		const csv = bookingTransactionsCsv([
			row(),
			row({ code: '22222222', chargesCentavos: 100_000, paidCentavos: 100_000, balanceCentavos: 0 })
		]);
		expect(csv.charCodeAt(0)).toBe(0xfeff);
		const lines = linesOf(csv);
		expect(lines[0]).toBe(
			'Booking code,Booked on,Guest,Email,Rooms / events,Check-in,Check-out,Status,Source,Payment method,Reference no.,Charges,Paid,Balance,Security deposit,Payment,SC/PWD'
		);
		expect(lines[1]).toBe(
			'11111111,2031-05-20,Ana Reyes,ana@example.com,Room 101,2031-06-01,2031-06-03,Confirmed,Online,paymongo,pay_abc,5000.00,2500.00,2500.00,,Balance due,'
		);
		expect(lines).toHaveLength(4);
		expect(lines[3]).toBe('Total,,2 bookings,,,,,,,,,6000.00,3500.00,2500.00,0.00,,');
	});

	it('quotes commas and quotes, and defuses formulas typed as a guest name or reference', () => {
		const csv = bookingTransactionsCsv([
			row({ guestName: 'Cruz, "JR" Santos', references: ['=1+1', 'slip 9'], methods: ['cash', 'gcash'] })
		]);
		const line = linesOf(csv)[1]!;
		expect(line).toContain('"Cruz, ""JR"" Santos"');
		expect(line).toContain(`"'=1+1, slip 9"`);
		expect(line).toContain('"cash, gcash"');
	});

	it('flags a partly cancelled booking and shows deposits', () => {
		const line = linesOf(bookingTransactionsCsv([row({ cancelledCount: 1, depositCentavos: 100_000 })]))[1]!;
		expect(line).toContain('Confirmed (1 cancelled)');
		expect(line.endsWith('1000.00')).toBe(true);
	});

	it('is just a header and a zero totals row when there is nothing in the range', () => {
		const lines = linesOf(bookingTransactionsCsv([]));
		expect(lines).toHaveLength(2);
		expect(lines[1]).toBe('Total,,0 bookings,,,,,,,,,0.00,0.00,0.00,0.00,,');
	});
});
