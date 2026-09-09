/**
 * One-off: give the demo hotel a compliant BIR setup + active serial ranges, and
 * report a booking + payment to render sample Invoice / Official Receipt documents.
 * Run with `pnpm tsx scripts/seed-bir-sample.ts`. Safe to re-run.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema/index';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: 'snake_case' });

const { hotels, birSettings, documentSeries, bookings, payments, orders } = schema;

async function main() {
	const slug = process.env.HOTEL_SLUG ?? 'hotel1';
	const [hotel] = await db.select().from(hotels).where(eq(hotels.slug, slug)).limit(1);
	if (!hotel) throw new Error(`hotel "${slug}" not found — run pnpm db:seed first`);
	console.log('hotel:', hotel.slug, hotel.id, '—', hotel.name, `(${hotel.legalName ?? 'no legal name'})`);

	// The demo hotel ships with vat_rate_bps 0; a VAT-registered scenario needs 12%.
	if (hotel.vatRateBps === 0) {
		await db.update(hotels).set({ vatRateBps: 1200 }).where(eq(hotels.id, hotel.id));
		console.log('hotels.vat_rate_bps: set to 1200 (12%)');
	}

	// 1. Compliant BIR setup
	const birRow = {
		hotelId: hotel.id,
		tin: '009-123-456-00000',
		isVatRegistered: true,
		registeredAddress: null,
		birPermitNo: 'CAS-125-2026-000042',
		permitDateIssued: '2026-01-15',
		accreditedPrinterName: 'Northwind Printing Services Inc.',
		accreditedPrinterTin: '004-555-777-00000',
		accreditedPrinterAccreditationNo: 'ACCRD-08-2025-0173',
		printerAccreditationDate: '2025-11-02',
		invoicePrefix: 'INV',
		orPrefix: 'OR',
		serialPadWidth: 6,
		autoIssueInvoiceOnCheckout: true,
		autoIssueReceiptOnPayment: true,
		footerNote: null,
		updatedAt: new Date()
	};
	await db.insert(birSettings).values(birRow).onConflictDoUpdate({ target: birSettings.hotelId, set: birRow });
	console.log('bir_settings: upserted (compliant footer active)');

	// 2. Active serial ranges (one per type), if none active yet
	for (const [type, prefix] of [['invoice', 'INV'], ['official_receipt', 'OR']] as const) {
		const [active] = await db
			.select({ id: documentSeries.id })
			.from(documentSeries)
			.where(
				and(
					eq(documentSeries.hotelId, hotel.id),
					eq(documentSeries.type, type),
					eq(documentSeries.status, 'active')
				)
			)
			.limit(1);
		if (active) {
			console.log(`document_series[${type}]: already active (${active.id})`);
			continue;
		}
		const [row] = await db
			.insert(documentSeries)
			.values({
				hotelId: hotel.id,
				type,
				prefix,
				serialFrom: 1,
				serialTo: 10000,
				nextSerial: 1,
				atpOrPermitNo: 'CAS-125-2026-000042',
				dateRegistered: '2026-01-15',
				accreditedPrinter: 'Northwind Printing Services Inc.',
				accreditationNo: 'ACCRD-08-2025-0173',
				status: 'active'
			})
			.returning({ id: documentSeries.id });
		console.log(`document_series[${type}]: created ${row!.id} (${prefix} 1–10000)`);
	}

	// 3. Report a booking + a payment to render
	const bk = await db
		.select({ id: bookings.id, status: bookings.status, total: bookings.totalCentavos })
		.from(bookings)
		.where(eq(bookings.hotelId, hotel.id))
		.limit(10);
	const pm = await db
		.select({ id: payments.id, method: payments.method, amount: payments.amountCentavos, status: payments.status })
		.from(payments)
		.innerJoin(orders, eq(orders.id, payments.orderId))
		.where(and(eq(orders.hotelId, hotel.id), eq(payments.status, 'paid')))
		.limit(10);

	console.log('\nbookings:', bk);
	console.log('paid payments:', pm);

	const base = process.env.ORIGIN ?? 'http://localhost:5175';
	if (bk[0]) console.log(`\nINVOICE  -> ${base}/${slug}/print/invoice/for/booking/${bk[0].id}`);
	if (pm[0]) console.log(`RECEIPT  -> ${base}/${slug}/print/receipt/${pm[0].id}`);
	if (!bk.length) console.log('\n(no bookings — create a walk-in in the app to get a folio to invoice)');
	if (!pm.length) console.log('(no paid payments — record one at the front desk to get an OR)');

	await client.end();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
