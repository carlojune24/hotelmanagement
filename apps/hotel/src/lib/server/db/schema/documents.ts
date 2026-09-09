import { relations, sql } from 'drizzle-orm';
import {
	bigint,
	date,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { boolean } from 'drizzle-orm/pg-core';
import { createdAt, pk, updatedAt } from './_shared';
import { hotels } from './hotels';
import { users } from './auth';
import { orders } from './orders';

/**
 * Philippine BIR accountable forms. This is the operational spine of the
 * `/{slug}/finance/bir` module and the printed Invoice / Official Receipt
 * documents under `/{slug}/print/*`:
 *
 * - `bir_settings` — one row per hotel: the tax identity + accredited-printer
 *   details that fill a compliant document's footer, plus prefixes / issuance
 *   toggles. Absent or incomplete → documents print a "computer-generated, not
 *   BIR-registered" disclaimer instead of the statutory footer.
 * - `document_series` — one row per BIR-authorized serial range (an ATP / CAS
 *   batch). Numbers are drawn from the **active** series for a type only; a new
 *   authority means a new series (possibly a new prefix / start). `next_serial`
 *   is bumped under a row lock inside the same transaction that issues a
 *   document, so the range is consumed gaplessly.
 * - `documents` — one row per issued Invoice or Official Receipt, carrying its
 *   assigned serial and a full `snapshot` of what was rendered, so a reprint is
 *   deterministic and never recomputed. `status` also covers `cancelled` /
 *   `spoiled` for the liquidation work in a later step.
 *
 * Money is `bigint` centavos, PHP — same convention as the rest of the schema.
 */

export const documentType = pgEnum('document_type', ['invoice', 'official_receipt']);

export const documentSeriesStatus = pgEnum('document_series_status', [
	'active',
	'exhausted',
	'superseded',
	'cancelled'
]);

export const documentStatus = pgEnum('document_status', ['issued', 'cancelled', 'spoiled']);

// ---------------------------------------------------------------------------
// BIR settings (one row per hotel)
// ---------------------------------------------------------------------------

export const birSettings = pgTable('bir_settings', {
	hotelId: uuid('hotel_id')
		.primaryKey()
		.references(() => hotels.id, { onDelete: 'cascade' }),
	/** Registered taxpayer identification number, shown on every document. */
	tin: text('tin'),
	/** VAT-registered hotels show a VAT split + 12% line; non-VAT show the
	 *  "NOT VALID FOR CLAIM OF INPUT TAX" phrase and no VAT. */
	isVatRegistered: boolean('is_vat_registered').notNull().default(true),
	/** Registered business address, if different from `hotels.address_line` — falls back to the hotel's. */
	registeredAddress: text('registered_address'),
	/** BIR permit number: the CAS / PTU / "Permit to Use" or ATP authority reference for the footer. */
	birPermitNo: text('bir_permit_no'),
	permitDateIssued: date('permit_date_issued', { mode: 'string' }),
	accreditedPrinterName: text('accredited_printer_name'),
	accreditedPrinterTin: text('accredited_printer_tin'),
	accreditedPrinterAccreditationNo: text('accredited_printer_accreditation_no'),
	printerAccreditationDate: date('printer_accreditation_date', { mode: 'string' }),
	invoicePrefix: text('invoice_prefix').notNull().default('INV'),
	orPrefix: text('or_prefix').notNull().default('OR'),
	/** Zero-pad width for the numeric part of a serial, e.g. 6 → `OR-000042`. */
	serialPadWidth: integer('serial_pad_width').notNull().default(6),
	/** Assign an Invoice serial automatically when a booking checks out. */
	autoIssueInvoiceOnCheckout: boolean('auto_issue_invoice_on_checkout').notNull().default(true),
	/** Assign an Official Receipt serial automatically when a payment is recorded. */
	autoIssueReceiptOnPayment: boolean('auto_issue_receipt_on_payment').notNull().default(true),
	/** One extra hotel-authored line in the document footer (optional). */
	footerNote: text('footer_note'),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

// ---------------------------------------------------------------------------
// Document series (BIR-authorized serial ranges)
// ---------------------------------------------------------------------------

export const documentSeries = pgTable(
	'document_series',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		type: documentType('type').notNull(),
		prefix: text('prefix').notNull(),
		serialFrom: bigint('serial_from', { mode: 'number' }).notNull(),
		serialTo: bigint('serial_to', { mode: 'number' }).notNull(),
		/** The next number to hand out; starts at `serial_from`, bumped by `allocateSerial`. */
		nextSerial: bigint('next_serial', { mode: 'number' }).notNull(),
		/** The ATP / permit that authorized *this* range (may differ from `bir_settings.bir_permit_no`). */
		atpOrPermitNo: text('atp_or_permit_no'),
		dateRegistered: date('date_registered', { mode: 'string' }),
		accreditedPrinter: text('accredited_printer'),
		accreditationNo: text('accreditation_no'),
		status: documentSeriesStatus('status').notNull().default('active'),
		notes: text('notes'),
		createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('document_series_hotel_idx').on(t.hotelId, t.type),
		// At most one active series per hotel per document type.
		uniqueIndex('document_series_one_active_idx')
			.on(t.hotelId, t.type)
			.where(sql`status = 'active'`)
	]
);

// ---------------------------------------------------------------------------
// Documents (issued Invoices / Official Receipts)
// ---------------------------------------------------------------------------

export const documents = pgTable(
	'documents',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		type: documentType('type').notNull(),
		seriesId: uuid('series_id')
			.notNull()
			.references(() => documentSeries.id, { onDelete: 'restrict' }),
		serialNo: bigint('serial_no', { mode: 'number' }).notNull(),
		/** `prefix` + zero-padded `serial_no`, e.g. `OR-000042` — snapshotted so a prefix change never rewrites it. */
		formattedNo: text('formatted_no').notNull(),
		status: documentStatus('status').notNull().default('issued'),
		/** Plain uuid (no FK), same posture as `payments.folio_id` — avoids a hard dependency cycle. */
		folioId: uuid('folio_id'),
		orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
		bookingId: uuid('booking_id'),
		hallBookingId: uuid('hall_booking_id'),
		/** Set for `official_receipt` — the payment this OR acknowledges. Plain uuid. */
		paymentId: uuid('payment_id'),
		/** An OR points at the Invoice it was applied to. */
		appliesToDocumentId: uuid('applies_to_document_id'),
		/** Cancellation replacement chain. */
		replacesDocumentId: uuid('replaces_document_id'),
		replacedByDocumentId: uuid('replaced_by_document_id'),
		billToName: text('bill_to_name'),
		billToAddress: text('bill_to_address'),
		billToTin: text('bill_to_tin'),
		/** Full rendered content at issue time (`DocumentSnapshot` in `lib/server/finance/documents.ts`). */
		snapshot: jsonb('snapshot').notNull().default({}),
		issuedByUserId: uuid('issued_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
		cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		cancelReason: text('cancel_reason'),
		spoiledByUserId: uuid('spoiled_by_user_id').references(() => users.id, { onDelete: 'set null' }),
		spoiledAt: timestamp('spoiled_at', { withTimezone: true }),
		spoilReason: text('spoil_reason'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('documents_hotel_idx').on(t.hotelId, t.type),
		uniqueIndex('documents_series_serial_idx').on(t.seriesId, t.serialNo),
		index('documents_folio_idx').on(t.folioId),
		index('documents_payment_idx').on(t.paymentId),
		// One live Invoice per folio, one live OR per payment — idempotency backstop.
		uniqueIndex('documents_one_invoice_per_folio_idx')
			.on(t.folioId)
			.where(sql`type = 'invoice' and status = 'issued'`),
		uniqueIndex('documents_one_or_per_payment_idx')
			.on(t.paymentId)
			.where(sql`type = 'official_receipt' and status = 'issued'`)
	]
);

// ---------------------------------------------------------------------------
// Z-readings — the BIR end-of-day sales record, one per day-close
// ---------------------------------------------------------------------------

/**
 * A locked snapshot of the day's sales, generated by `runDayClose`. Each carries
 * a monotonic per-hotel `z_counter` and the running grand-total accumulation
 * (`prev_grand_total` → `+ net_sales` → `new_grand_total`) BIR expects on a Z.
 * Never edited or deleted; re-closing a reopened day issues a fresh row with the
 * next counter. The on-demand X-reading is the same computation with no row
 * written and no counter consumed.
 */
export const zReadings = pgTable(
	'z_readings',
	{
		id: pk(),
		hotelId: uuid('hotel_id')
			.notNull()
			.references(() => hotels.id, { onDelete: 'cascade' }),
		zCounter: integer('z_counter').notNull(),
		businessDate: date('business_date', { mode: 'string' }).notNull(),
		dayCloseId: uuid('day_close_id'),
		// Accountable-form serial spans consumed on the day
		invoiceBeginNo: text('invoice_begin_no'),
		invoiceEndNo: text('invoice_end_no'),
		invoiceCount: integer('invoice_count').notNull().default(0),
		orBeginNo: text('or_begin_no'),
		orEndNo: text('or_end_no'),
		orCount: integer('or_count').notNull().default(0),
		// Sales
		grossSalesCentavos: bigint('gross_sales_centavos', { mode: 'number' }).notNull().default(0),
		vatableSalesCentavos: bigint('vatable_sales_centavos', { mode: 'number' }).notNull().default(0),
		vatExemptSalesCentavos: bigint('vat_exempt_sales_centavos', { mode: 'number' })
			.notNull()
			.default(0),
		zeroRatedSalesCentavos: bigint('zero_rated_sales_centavos', { mode: 'number' })
			.notNull()
			.default(0),
		vatCentavos: bigint('vat_centavos', { mode: 'number' }).notNull().default(0),
		scPwdDiscountCentavos: bigint('sc_pwd_discount_centavos', { mode: 'number' })
			.notNull()
			.default(0),
		otherDiscountCentavos: bigint('other_discount_centavos', { mode: 'number' }).notNull().default(0),
		voidCount: integer('void_count').notNull().default(0),
		voidAmountCentavos: bigint('void_amount_centavos', { mode: 'number' }).notNull().default(0),
		refundCount: integer('refund_count').notNull().default(0),
		refundAmountCentavos: bigint('refund_amount_centavos', { mode: 'number' }).notNull().default(0),
		netSalesCentavos: bigint('net_sales_centavos', { mode: 'number' }).notNull().default(0),
		// Grand-total accumulation
		prevGrandTotalCentavos: bigint('prev_grand_total_centavos', { mode: 'number' })
			.notNull()
			.default(0),
		newGrandTotalCentavos: bigint('new_grand_total_centavos', { mode: 'number' })
			.notNull()
			.default(0),
		/** `{ "cash": 12345, "gcash": 6789, ... }` in centavos, non-voided paid payments for the day. */
		tenderBreakdown: jsonb('tender_breakdown').notNull().default({}),
		generatedByUserId: uuid('generated_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
		notes: text('notes'),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('z_readings_hotel_counter_idx').on(t.hotelId, t.zCounter),
		index('z_readings_hotel_date_idx').on(t.hotelId, t.businessDate)
	]
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const zReadingsRelations = relations(zReadings, ({ one }) => ({
	hotel: one(hotels, { fields: [zReadings.hotelId], references: [hotels.id] })
}));

export const birSettingsRelations = relations(birSettings, ({ one }) => ({
	hotel: one(hotels, { fields: [birSettings.hotelId], references: [hotels.id] })
}));

export const documentSeriesRelations = relations(documentSeries, ({ one, many }) => ({
	hotel: one(hotels, { fields: [documentSeries.hotelId], references: [hotels.id] }),
	documents: many(documents)
}));

export const documentsRelations = relations(documents, ({ one }) => ({
	hotel: one(hotels, { fields: [documents.hotelId], references: [hotels.id] }),
	series: one(documentSeries, { fields: [documents.seriesId], references: [documentSeries.id] }),
	order: one(orders, { fields: [documents.orderId], references: [orders.id] }),
	issuedBy: one(users, { fields: [documents.issuedByUserId], references: [users.id] })
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type BirSettings = typeof birSettings.$inferSelect;
export type NewBirSettings = typeof birSettings.$inferInsert;
export type DocumentSeries = typeof documentSeries.$inferSelect;
export type NewDocumentSeries = typeof documentSeries.$inferInsert;
export type IssuedDocument = typeof documents.$inferSelect;
export type NewIssuedDocument = typeof documents.$inferInsert;
export type ZReading = typeof zReadings.$inferSelect;
export type NewZReading = typeof zReadings.$inferInsert;
