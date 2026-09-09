import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index';
import {
	birSettings,
	bookings,
	documentSeries,
	documents,
	functionHalls,
	guests,
	hallBookings,
	hotels,
	orders,
	payments,
	users
} from '../db/schema/index';
import type { BirSettings, DocumentSeries, IssuedDocument } from '../db/schema/documents';
import { getFolioDetail, getOrderIdForTarget, type FolioTarget } from '../folio';
import { writeAudit } from '../audit';
import { businessDateFor } from './shared';
import type { SessionUser } from '../auth/session';
import type { Tx } from './shared';

/** Anything the accountable-forms code refuses for a business reason (no active
 *  series, an exhausted range, a missing folio) — route actions surface `.message`. */
export class DocumentError extends Error {}

type DocType = 'invoice' | 'official_receipt';

const TYPE_LABEL: Record<DocType, string> = {
	invoice: 'Invoice',
	official_receipt: 'Official Receipt'
};

// ---------------------------------------------------------------------------
// Snapshot shape — the full rendered content of a document, frozen at issue time
// ---------------------------------------------------------------------------

export interface DocumentSnapshotLine {
	description: string;
	quantity: number;
	unitPriceCentavos: number;
	amountCentavos: number;
	vatable: boolean;
}

export interface DocumentSnapshot {
	hotel: {
		name: string;
		legalName: string | null;
		address: string | null;
		tin: string | null;
		isVatRegistered: boolean;
	};
	bir: {
		configured: boolean;
		permitNo: string | null;
		permitDateIssued: string | null;
		accreditedPrinter: string | null;
		accreditationNo: string | null;
		serialRange: { prefix: string; from: number; to: number } | null;
		footerNote: string | null;
	};
	document: {
		type: DocType;
		typeLabel: string;
		formattedNo: string;
		issuedAtIso: string;
		businessDate: string;
		preparedBy: string | null;
		isReprint: boolean;
	};
	billTo: { name: string | null; address: string | null; tin: string | null };
	reference: {
		folioRef: string | null;
		bookingRef: string | null;
		stayDates: string | null;
		orderRef: string | null;
		appliedToInvoiceNo: string | null;
	};
	lines: DocumentSnapshotLine[];
	totals: {
		vatableSalesCentavos: number;
		vatExemptSalesCentavos: number;
		zeroRatedSalesCentavos: number;
		vatCentavos: number;
		grossCentavos: number;
		// Invoice
		lessPaymentsCentavos: number | null;
		balanceDueCentavos: number | null;
		// Official Receipt
		amountPaidCentavos: number | null;
		paymentMethod: string | null;
		paymentReferenceNo: string | null;
		tenderedCentavos: number | null;
		changeCentavos: number | null;
		balanceCarriedCentavos: number | null;
	};
	amountInWords: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function formatSerial(prefix: string, serialNo: number, padWidth: number): string {
	const num = String(serialNo).padStart(Math.max(1, padWidth), '0');
	// Group the accountable number away from its prefix so it scans at a glance
	// (`OR-000042`), unless the hotel already ended the prefix with a separator.
	const sep = /[A-Za-z0-9]$/.test(prefix) ? '-' : '';
	return `${prefix}${sep}${num}`;
}

const ONES = [
	'ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
	'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'
] as const;
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'] as const;
const SCALES = ['', ' THOUSAND', ' MILLION', ' BILLION'] as const;

function threeDigitsToWords(n: number): string {
	const parts: string[] = [];
	if (n >= 100) {
		parts.push(`${ONES[Math.floor(n / 100)] ?? ''} HUNDRED`);
		n %= 100;
	}
	if (n >= 20) {
		parts.push((TENS[Math.floor(n / 10)] ?? '') + (n % 10 ? `-${ONES[n % 10] ?? ''}` : ''));
	} else if (n > 0) {
		parts.push(ONES[n] ?? '');
	}
	return parts.join(' ');
}

/** `1234.50` → `ONE THOUSAND TWO HUNDRED THIRTY-FOUR PESOS AND 50/100 ONLY` (PH accountable-form convention). */
export function amountInWords(centavos: number): string {
	const abs = Math.abs(Math.round(centavos));
	const whole = Math.floor(abs / 100);
	const cents = abs % 100;
	let words: string;
	if (whole === 0) {
		words = 'ZERO';
	} else {
		const groups: string[] = [];
		let remaining = whole;
		let scale = 0;
		while (remaining > 0 && scale < SCALES.length) {
			const chunk = remaining % 1000;
			if (chunk > 0) groups.unshift(threeDigitsToWords(chunk) + (SCALES[scale] ?? ''));
			remaining = Math.floor(remaining / 1000);
			scale += 1;
		}
		words = groups.join(' ');
	}
	const sign = centavos < 0 ? 'MINUS ' : '';
	return `${sign}${words} PESOS AND ${String(cents).padStart(2, '0')}/100 ONLY`;
}

// ---------------------------------------------------------------------------
// BIR settings
// ---------------------------------------------------------------------------

export async function getBirSettings(hotelId: string): Promise<BirSettings | null> {
	const [row] = await db.select().from(birSettings).where(eq(birSettings.hotelId, hotelId)).limit(1);
	return row ?? null;
}

export interface BirSettingsInput {
	tin: string | null;
	isVatRegistered: boolean;
	registeredAddress: string | null;
	birPermitNo: string | null;
	permitDateIssued: string | null;
	accreditedPrinterName: string | null;
	accreditedPrinterTin: string | null;
	accreditedPrinterAccreditationNo: string | null;
	printerAccreditationDate: string | null;
	invoicePrefix: string;
	orPrefix: string;
	serialPadWidth: number;
	autoIssueInvoiceOnCheckout: boolean;
	autoIssueReceiptOnPayment: boolean;
	footerNote: string | null;
}

export async function upsertBirSettings(
	hotelId: string,
	input: BirSettingsInput,
	actor: SessionUser | null
): Promise<void> {
	const values = {
		hotelId,
		...input,
		invoicePrefix: input.invoicePrefix.trim() || 'INV',
		orPrefix: input.orPrefix.trim() || 'OR',
		serialPadWidth: Math.min(12, Math.max(1, Math.round(input.serialPadWidth || 6))),
		updatedAt: new Date()
	};
	await db
		.insert(birSettings)
		.values(values)
		.onConflictDoUpdate({ target: birSettings.hotelId, set: values });

	await writeAudit({
		hotelId,
		actor,
		action: 'bir.update_settings',
		entityType: 'hotel',
		entityId: hotelId,
		after: { tin: input.tin, isVatRegistered: input.isVatRegistered }
	});
}

/** Whether the hotel's BIR identity is complete enough to print the statutory footer. */
export function birConfigured(s: BirSettings | null): boolean {
	return !!(s && s.tin && s.birPermitNo && s.accreditedPrinterName);
}

// ---------------------------------------------------------------------------
// Document series (BIR-authorized serial ranges)
// ---------------------------------------------------------------------------

export async function listDocumentSeries(hotelId: string): Promise<DocumentSeries[]> {
	return db
		.select()
		.from(documentSeries)
		.where(eq(documentSeries.hotelId, hotelId))
		.orderBy(desc(documentSeries.createdAt));
}

export interface CreateSeriesInput {
	type: DocType;
	prefix: string;
	serialFrom: number;
	serialTo: number;
	startAt?: number | null;
	atpOrPermitNo: string | null;
	dateRegistered: string | null;
	accreditedPrinter: string | null;
	accreditationNo: string | null;
	notes: string | null;
}

export async function createDocumentSeries(
	hotelId: string,
	input: CreateSeriesInput,
	actor: SessionUser | null
): Promise<string> {
	const from = Math.round(input.serialFrom);
	const to = Math.round(input.serialTo);
	if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
		throw new DocumentError('Enter a valid serial range — "to" must be at least "from".');
	}
	const start = input.startAt != null ? Math.round(input.startAt) : from;
	if (start < from || start > to) {
		throw new DocumentError('The starting number must fall inside the range.');
	}
	const prefix = input.prefix.trim();
	if (!prefix) throw new DocumentError('A series needs a prefix.');

	const id = await db.transaction(async (tx) => {
		// Any existing active series of this type is superseded by the new one.
		await tx
			.update(documentSeries)
			.set({ status: 'superseded', updatedAt: new Date() })
			.where(
				and(
					eq(documentSeries.hotelId, hotelId),
					eq(documentSeries.type, input.type),
					eq(documentSeries.status, 'active')
				)
			);

		const [row] = await tx
			.insert(documentSeries)
			.values({
				hotelId,
				type: input.type,
				prefix,
				serialFrom: from,
				serialTo: to,
				nextSerial: start,
				atpOrPermitNo: input.atpOrPermitNo?.trim() || null,
				dateRegistered: input.dateRegistered || null,
				accreditedPrinter: input.accreditedPrinter?.trim() || null,
				accreditationNo: input.accreditationNo?.trim() || null,
				notes: input.notes?.trim() || null,
				status: 'active',
				createdByUserId: actor?.id ?? null
			})
			.returning({ id: documentSeries.id });
		return row!.id;
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'bir.create_series',
		entityType: 'document_series',
		entityId: id,
		after: { type: input.type, prefix, from, to }
	});
	return id;
}

export async function setDocumentSeriesStatus(
	hotelId: string,
	seriesId: string,
	status: 'exhausted' | 'superseded' | 'cancelled' | 'active',
	actor: SessionUser | null
): Promise<void> {
	await db.transaction(async (tx) => {
		const [series] = await tx
			.select()
			.from(documentSeries)
			.where(and(eq(documentSeries.id, seriesId), eq(documentSeries.hotelId, hotelId)))
			.limit(1);
		if (!series) throw new DocumentError('Series not found.');

		if (status === 'active') {
			// Re-activating: demote whatever is currently active for this type first.
			await tx
				.update(documentSeries)
				.set({ status: 'superseded', updatedAt: new Date() })
				.where(
					and(
						eq(documentSeries.hotelId, hotelId),
						eq(documentSeries.type, series.type),
						eq(documentSeries.status, 'active')
					)
				);
		}
		await tx
			.update(documentSeries)
			.set({ status, updatedAt: new Date() })
			.where(eq(documentSeries.id, seriesId));
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'bir.set_series_status',
		entityType: 'document_series',
		entityId: seriesId,
		after: { status }
	});
}

/**
 * Draws the next unused serial from the active series for `type`, bumping the
 * counter under a row lock **inside the caller's transaction** so the range is
 * consumed gaplessly. Flips the series to `exhausted` when it hands out the last
 * number, and refuses (without burning a number) when there's nothing left.
 */
export async function allocateSerial(
	tx: Tx,
	hotelId: string,
	type: DocType,
	padWidth: number
): Promise<{ seriesId: string; serialNo: number; formattedNo: string }> {
	const [series] = await tx
		.select()
		.from(documentSeries)
		.where(
			and(
				eq(documentSeries.hotelId, hotelId),
				eq(documentSeries.type, type),
				eq(documentSeries.status, 'active')
			)
		)
		.for('update')
		.limit(1);

	if (!series) {
		throw new DocumentError(
			`No active ${TYPE_LABEL[type]} series is registered. Add one in Finance → BIR → Series.`
		);
	}
	if (series.nextSerial > series.serialTo) {
		await tx
			.update(documentSeries)
			.set({ status: 'exhausted', updatedAt: new Date() })
			.where(eq(documentSeries.id, series.id));
		throw new DocumentError(
			`The active ${TYPE_LABEL[type]} series (${series.prefix} ${series.serialFrom}–${series.serialTo}) is used up. Register the next BIR-authorized range.`
		);
	}

	const serialNo = series.nextSerial;
	const exhausted = serialNo >= series.serialTo;
	await tx
		.update(documentSeries)
		.set({
			nextSerial: serialNo + 1,
			status: exhausted ? 'exhausted' : 'active',
			updatedAt: new Date()
		})
		.where(eq(documentSeries.id, series.id));

	return { seriesId: series.id, serialNo, formattedNo: formatSerial(series.prefix, serialNo, padWidth) };
}

// ---------------------------------------------------------------------------
// Snapshot builders
// ---------------------------------------------------------------------------

async function hotelIdentity(hotelId: string) {
	const [hotel] = await db
		.select({
			name: hotels.name,
			legalName: hotels.legalName,
			addressLine: hotels.addressLine,
			city: hotels.city,
			timezone: hotels.timezone
		})
		.from(hotels)
		.where(eq(hotels.id, hotelId))
		.limit(1);
	if (!hotel) throw new DocumentError('Hotel not found.');
	return hotel;
}

function baseSnapshot(
	hotel: Awaited<ReturnType<typeof hotelIdentity>>,
	s: BirSettings | null
): Pick<DocumentSnapshot, 'hotel' | 'bir'> {
	const address =
		s?.registeredAddress ||
		[hotel.addressLine, hotel.city].filter(Boolean).join(', ') ||
		null;
	return {
		hotel: {
			name: hotel.name,
			legalName: hotel.legalName,
			address,
			tin: s?.tin ?? null,
			isVatRegistered: s?.isVatRegistered ?? false
		},
		bir: {
			configured: birConfigured(s),
			permitNo: s?.birPermitNo ?? null,
			permitDateIssued: s?.permitDateIssued ?? null,
			accreditedPrinter: s?.accreditedPrinterName ?? null,
			accreditationNo: s?.accreditedPrinterAccreditationNo ?? null,
			serialRange: null,
			footerNote: s?.footerNote ?? null
		}
	};
}

async function guestAndOrder(orderId: string) {
	const [row] = await db
		.select({
			order: orders,
			guestName: guests.fullName,
			guestPhone: guests.phone
		})
		.from(orders)
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.where(eq(orders.id, orderId))
		.limit(1);
	return row ?? null;
}

/** Everything an Invoice needs, computed from the folio + its booking/hall + the hotel's BIR identity. */
export async function buildInvoiceSnapshot(
	hotelId: string,
	target: FolioTarget
): Promise<DocumentSnapshot> {
	const [hotel, s] = await Promise.all([hotelIdentity(hotelId), getBirSettings(hotelId)]);
	const base = baseSnapshot(hotel, s);
	const isVat = base.hotel.isVatRegistered;

	const folio = await getFolioDetail(hotelId, target);
	const orderId = await getOrderIdForTarget(target);
	const go = orderId ? await guestAndOrder(orderId) : null;

	let stayDates: string | null = null;
	let bookingRef: string | null = null;
	if (target.kind === 'room') {
		const [b] = await db
			.select()
			.from(bookings)
			.where(eq(bookings.id, target.bookingId))
			.limit(1);
		if (b) {
			stayDates = `${b.checkIn} → ${b.checkOut}`;
			bookingRef = b.id.slice(0, 8).toUpperCase();
		}
	} else {
		const [h] = await db
			.select({ hb: hallBookings, hallName: functionHalls.name })
			.from(hallBookings)
			.innerJoin(functionHalls, eq(functionHalls.id, hallBookings.functionHallId))
			.where(eq(hallBookings.id, target.hallBookingId))
			.limit(1);
		if (h) {
			stayDates = `${h.hb.eventDate}`;
			bookingRef = h.hb.id.slice(0, 8).toUpperCase();
		}
	}

	const nonVoid = folio.charges.filter((c) => !c.voidedAt);
	const lines: DocumentSnapshotLine[] = nonVoid.map((c) => {
		const net = c.quantity * c.unitPriceCentavos;
		return {
			description: c.description,
			quantity: c.quantity,
			unitPriceCentavos: c.unitPriceCentavos,
			amountCentavos: c.isBaseCharge ? c.totalCentavos : net,
			vatable: isVat && (c.isBaseCharge || c.taxCentavos > 0)
		};
	});

	const gross = folio.chargesTotalCentavos;
	let vatCentavos = 0;
	let vatableSales = 0;
	if (isVat) {
		for (const c of nonVoid) {
			if (c.isBaseCharge) {
				// The seeded line already bundles VAT — recover it from the booking/hall breakdown.
				if (target.kind === 'room') {
					const [b] = await db
						.select({ v: bookings.vatCentavos, sub: bookings.subtotalCentavos, fees: bookings.feesCentavos })
						.from(bookings)
						.where(eq(bookings.id, target.bookingId))
						.limit(1);
					if (b) {
						vatCentavos += b.v;
						vatableSales += b.sub + b.fees;
					}
				} else {
					const [h] = await db
						.select({
							v: hallBookings.vatCentavos,
							sub: hallBookings.subtotalCentavos,
							fees: hallBookings.feesCentavos
						})
						.from(hallBookings)
						.where(eq(hallBookings.id, target.hallBookingId))
						.limit(1);
					if (h) {
						vatCentavos += h.v;
						vatableSales += h.sub + h.fees;
					}
				}
			} else if (c.taxCentavos > 0) {
				vatCentavos += c.taxCentavos;
				vatableSales += c.quantity * c.unitPriceCentavos;
			}
		}
	}
	const vatExemptSales = Math.max(0, gross - vatCentavos - vatableSales);

	return {
		...base,
		document: {
			type: 'invoice',
			typeLabel: TYPE_LABEL.invoice,
			formattedNo: '',
			issuedAtIso: '',
			businessDate: businessDateFor(hotel.timezone),
			preparedBy: null,
			isReprint: false
		},
		billTo: {
			name: go?.guestName ?? null,
			address: go?.guestPhone ?? null,
			tin: null
		},
		reference: {
			folioRef: folio.folioId.slice(0, 8).toUpperCase(),
			bookingRef,
			stayDates,
			orderRef: orderId ? orderId.slice(0, 8).toUpperCase() : null,
			appliedToInvoiceNo: null
		},
		lines,
		totals: {
			vatableSalesCentavos: vatableSales,
			vatExemptSalesCentavos: vatExemptSales,
			zeroRatedSalesCentavos: 0,
			vatCentavos,
			grossCentavos: gross,
			lessPaymentsCentavos: folio.paidTotalCentavos,
			balanceDueCentavos: folio.balanceCentavos,
			amountPaidCentavos: null,
			paymentMethod: null,
			paymentReferenceNo: null,
			tenderedCentavos: null,
			changeCentavos: null,
			balanceCarriedCentavos: null
		},
		amountInWords: amountInWords(gross)
	};
}

const METHOD_LABEL: Record<string, string> = {
	cash: 'Cash',
	card: 'Card',
	gcash: 'GCash',
	maya: 'Maya',
	bank_transfer: 'Bank transfer',
	cheque: 'Cheque',
	paymongo: 'Online (PayMongo)',
	house_use: 'City ledger'
};

/** Everything an Official Receipt needs — the one payment it acknowledges, plus a link to its Invoice. */
export async function buildReceiptSnapshot(
	hotelId: string,
	paymentId: string,
	appliedToInvoiceNo: string | null
): Promise<DocumentSnapshot> {
	const [hotel, s] = await Promise.all([hotelIdentity(hotelId), getBirSettings(hotelId)]);
	const base = baseSnapshot(hotel, s);

	const [pay] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
	if (!pay) throw new DocumentError('Payment not found.');

	const go = await guestAndOrder(pay.orderId);
	if (!go || go.order.hotelId !== hotelId) throw new DocumentError('Payment not found.');

	// Balance still owed after this payment, when the payment is tied to a folio.
	let balanceCarried: number | null = null;
	if (pay.folioId) {
		const [folio] = await db
			.select({ bookingId: bookings.id })
			.from(bookings)
			.where(eq(bookings.orderId, pay.orderId))
			.limit(1);
		if (folio) {
			try {
				const fd = await getFolioDetail(hotelId, { kind: 'room', bookingId: folio.bookingId });
				balanceCarried = fd.balanceCentavos;
			} catch {
				balanceCarried = null;
			}
		}
	}

	const isRefund = pay.amountCentavos < 0;
	const amount = Math.abs(pay.amountCentavos);

	return {
		...base,
		document: {
			type: 'official_receipt',
			typeLabel: isRefund ? 'Official Receipt (Refund)' : TYPE_LABEL.official_receipt,
			formattedNo: '',
			issuedAtIso: '',
			businessDate: businessDateFor(hotel.timezone),
			preparedBy: null,
			isReprint: false
		},
		billTo: { name: go.guestName, address: go.guestPhone ?? null, tin: null },
		reference: {
			folioRef: pay.folioId ? pay.folioId.slice(0, 8).toUpperCase() : null,
			bookingRef: null,
			stayDates: null,
			orderRef: pay.orderId.slice(0, 8).toUpperCase(),
			appliedToInvoiceNo
		},
		lines: [
			{
				description: isRefund
					? `Refund — ${METHOD_LABEL[pay.method] ?? pay.method}`
					: `Payment received — ${METHOD_LABEL[pay.method] ?? pay.method}`,
				quantity: 1,
				unitPriceCentavos: amount,
				amountCentavos: amount,
				vatable: false
			}
		],
		totals: {
			vatableSalesCentavos: 0,
			vatExemptSalesCentavos: 0,
			zeroRatedSalesCentavos: 0,
			vatCentavos: 0,
			grossCentavos: amount,
			lessPaymentsCentavos: null,
			balanceDueCentavos: null,
			amountPaidCentavos: pay.amountCentavos,
			paymentMethod: METHOD_LABEL[pay.method] ?? pay.method,
			paymentReferenceNo: pay.referenceNo ?? null,
			tenderedCentavos: pay.tenderedCentavos ?? null,
			changeCentavos: pay.changeCentavos ?? null,
			balanceCarriedCentavos: balanceCarried
		},
		amountInWords: amountInWords(amount)
	};
}

// ---------------------------------------------------------------------------
// Issuance
// ---------------------------------------------------------------------------

function fillSerialRange(snap: DocumentSnapshot, series: { prefix: string; serialFrom: number; serialTo: number }) {
	snap.bir.serialRange = { prefix: series.prefix, from: series.serialFrom, to: series.serialTo };
}

/** Issues (or returns the already-issued) Invoice for a folio target. Idempotent. */
export async function issueInvoice(
	hotelId: string,
	target: FolioTarget,
	actor: SessionUser | null
): Promise<IssuedDocument> {
	const folio = await getFolioDetail(hotelId, target);

	const [existing] = await db
		.select()
		.from(documents)
		.where(
			and(
				eq(documents.hotelId, hotelId),
				eq(documents.folioId, folio.folioId),
				eq(documents.type, 'invoice'),
				eq(documents.status, 'issued')
			)
		)
		.limit(1);
	if (existing) return existing;

	const s = await getBirSettings(hotelId);
	const padWidth = s?.serialPadWidth ?? 6;
	const snapshot = await buildInvoiceSnapshot(hotelId, target);
	const orderId = await getOrderIdForTarget(target);

	const row = await db.transaction(async (tx) => {
		const alloc = await allocateSerial(tx, hotelId, 'invoice', padWidth);
		const [series] = await tx
			.select()
			.from(documentSeries)
			.where(eq(documentSeries.id, alloc.seriesId))
			.limit(1);
		snapshot.document.formattedNo = alloc.formattedNo;
		snapshot.document.issuedAtIso = new Date().toISOString();
		snapshot.document.preparedBy = actor?.name ?? null;
		if (series) fillSerialRange(snapshot, series);

		const [inserted] = await tx
			.insert(documents)
			.values({
				hotelId,
				type: 'invoice',
				seriesId: alloc.seriesId,
				serialNo: alloc.serialNo,
				formattedNo: alloc.formattedNo,
				folioId: folio.folioId,
				orderId,
				bookingId: target.kind === 'room' ? target.bookingId : null,
				hallBookingId: target.kind === 'hall' ? target.hallBookingId : null,
				billToName: snapshot.billTo.name,
				billToAddress: snapshot.billTo.address,
				snapshot,
				issuedByUserId: actor?.id ?? null
			})
			.returning();
		return inserted!;
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'bir.issue_invoice',
		entityType: target.kind === 'room' ? 'booking' : 'hall_booking',
		entityId: target.kind === 'room' ? target.bookingId : target.hallBookingId,
		after: { documentId: row.id, formattedNo: row.formattedNo }
	});
	return row;
}

/** Issues (or returns the already-issued) Official Receipt for a payment. Idempotent. */
export async function issueOfficialReceipt(
	hotelId: string,
	paymentId: string,
	actor: SessionUser | null
): Promise<IssuedDocument> {
	const [existing] = await db
		.select()
		.from(documents)
		.where(
			and(
				eq(documents.hotelId, hotelId),
				eq(documents.paymentId, paymentId),
				eq(documents.type, 'official_receipt'),
				eq(documents.status, 'issued')
			)
		)
		.limit(1);
	if (existing) return existing;

	const [pay] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
	if (!pay) throw new DocumentError('Payment not found.');

	// An Official Receipt only *references* an Invoice that already exists — it never
	// issues one. Issuing an Invoice consumes a BIR-authorized invoice serial and is a
	// deliberate act (check-out, or an explicit "issue invoice"); a payment must be
	// receiptable on its own (a deposit, a partial payment, a stay not yet checked out).
	let appliesToDocumentId: string | null = null;
	let appliedToInvoiceNo: string | null = null;
	if (pay.folioId) {
		const [inv] = await db
			.select({ id: documents.id, formattedNo: documents.formattedNo })
			.from(documents)
			.where(
				and(
					eq(documents.hotelId, hotelId),
					eq(documents.folioId, pay.folioId),
					eq(documents.type, 'invoice'),
					eq(documents.status, 'issued')
				)
			)
			.limit(1);
		if (inv) {
			appliesToDocumentId = inv.id;
			appliedToInvoiceNo = inv.formattedNo;
		}
	}

	const s = await getBirSettings(hotelId);
	const padWidth = s?.serialPadWidth ?? 6;
	const snapshot = await buildReceiptSnapshot(hotelId, paymentId, appliedToInvoiceNo);

	const row = await db.transaction(async (tx) => {
		const alloc = await allocateSerial(tx, hotelId, 'official_receipt', padWidth);
		const [series] = await tx
			.select()
			.from(documentSeries)
			.where(eq(documentSeries.id, alloc.seriesId))
			.limit(1);
		snapshot.document.formattedNo = alloc.formattedNo;
		snapshot.document.issuedAtIso = new Date().toISOString();
		snapshot.document.preparedBy = actor?.name ?? null;
		if (series) fillSerialRange(snapshot, series);

		const [inserted] = await tx
			.insert(documents)
			.values({
				hotelId,
				type: 'official_receipt',
				seriesId: alloc.seriesId,
				serialNo: alloc.serialNo,
				formattedNo: alloc.formattedNo,
				folioId: pay.folioId ?? null,
				orderId: pay.orderId,
				paymentId,
				appliesToDocumentId,
				billToName: snapshot.billTo.name,
				billToAddress: snapshot.billTo.address,
				snapshot,
				issuedByUserId: actor?.id ?? null
			})
			.returning();
		return inserted!;
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'bir.issue_official_receipt',
		entityType: 'payment',
		entityId: paymentId,
		after: { documentId: row.id, formattedNo: row.formattedNo }
	});
	return row;
}

// ---------------------------------------------------------------------------
// Reads for rendering / listing
// ---------------------------------------------------------------------------

export interface DocumentForRender {
	document: IssuedDocument;
	snapshot: DocumentSnapshot;
}

export async function getDocumentForRender(
	hotelId: string,
	documentId: string
): Promise<DocumentForRender | null> {
	const [row] = await db
		.select()
		.from(documents)
		.where(and(eq(documents.id, documentId), eq(documents.hotelId, hotelId)))
		.limit(1);
	if (!row) return null;
	return { document: row, snapshot: row.snapshot as DocumentSnapshot };
}

/** Lazily issues the Invoice for a folio if none exists yet, then returns it for rendering. */
export async function getOrIssueInvoiceForTarget(
	hotelId: string,
	target: FolioTarget,
	actor: SessionUser | null
): Promise<DocumentForRender> {
	const doc = await issueInvoice(hotelId, target, actor);
	return { document: doc, snapshot: doc.snapshot as DocumentSnapshot };
}

export async function getOrIssueReceiptForPayment(
	hotelId: string,
	paymentId: string,
	actor: SessionUser | null
): Promise<DocumentForRender> {
	const doc = await issueOfficialReceipt(hotelId, paymentId, actor);
	return { document: doc, snapshot: doc.snapshot as DocumentSnapshot };
}

export interface DocumentListRow {
	id: string;
	type: DocType;
	formattedNo: string;
	status: 'issued' | 'cancelled' | 'spoiled';
	billToName: string | null;
	grossCentavos: number;
	issuedAt: Date;
}

export async function listDocuments(
	hotelId: string,
	filter?: { type?: DocType }
): Promise<DocumentListRow[]> {
	const rows = await db
		.select()
		.from(documents)
		.where(
			filter?.type
				? and(eq(documents.hotelId, hotelId), eq(documents.type, filter.type))
				: eq(documents.hotelId, hotelId)
		)
		.orderBy(desc(documents.issuedAt))
		.limit(500);

	return rows.map((r) => ({
		id: r.id,
		type: r.type,
		formattedNo: r.formattedNo,
		status: r.status,
		billToName: r.billToName,
		grossCentavos: (r.snapshot as DocumentSnapshot)?.totals?.grossCentavos ?? 0,
		issuedAt: r.issuedAt
	}));
}

/** Resolves the order `access_token` guard for a guest-facing document URL. */
export async function documentOrderToken(documentId: string): Promise<string | null> {
	const [row] = await db
		.select({ token: orders.accessToken })
		.from(documents)
		.innerJoin(orders, eq(orders.id, documents.orderId))
		.where(eq(documents.id, documentId))
		.limit(1);
	return row?.token ?? null;
}

// ---------------------------------------------------------------------------
// Liquidation — accounting for every serial in a registered range
// ---------------------------------------------------------------------------

/**
 * Cancels an issued Invoice / Official Receipt. The number stays permanently dead
 * (`status = 'cancelled'`, retained with its snapshot for the audit trail) — it is
 * never reused. Optionally issues a fresh replacement document (a new serial) and
 * links the two. This is a *document* action: the underlying payment / folio is not
 * touched — void or refund the payment separately at the front desk if the money
 * itself is being reversed.
 */
export async function cancelDocument(
	hotelId: string,
	documentId: string,
	reason: string,
	actor: SessionUser | null,
	opts: { issueReplacement?: boolean } = {}
): Promise<{ cancelled: IssuedDocument; replacement: IssuedDocument | null }> {
	if (!reason.trim()) throw new DocumentError('A cancellation reason is required.');

	const [doc] = await db
		.select()
		.from(documents)
		.where(and(eq(documents.id, documentId), eq(documents.hotelId, hotelId)))
		.limit(1);
	if (!doc) throw new DocumentError('Document not found.');
	if (doc.status !== 'issued') throw new DocumentError(`That document is already ${doc.status}.`);

	await db
		.update(documents)
		.set({
			status: 'cancelled',
			cancelledAt: new Date(),
			cancelledByUserId: actor?.id ?? null,
			cancelReason: reason.trim(),
			updatedAt: new Date()
		})
		.where(eq(documents.id, documentId));

	let replacement: IssuedDocument | null = null;
	if (opts.issueReplacement) {
		try {
			if (doc.type === 'invoice' && doc.bookingId) {
				replacement = await issueInvoice(hotelId, { kind: 'room', bookingId: doc.bookingId }, actor);
			} else if (doc.type === 'invoice' && doc.hallBookingId) {
				replacement = await issueInvoice(
					hotelId,
					{ kind: 'hall', hallBookingId: doc.hallBookingId },
					actor
				);
			} else if (doc.type === 'official_receipt' && doc.paymentId) {
				replacement = await issueOfficialReceipt(hotelId, doc.paymentId, actor);
			}
			if (replacement) {
				await db
					.update(documents)
					.set({ replacedByDocumentId: replacement.id, updatedAt: new Date() })
					.where(eq(documents.id, documentId));
				await db
					.update(documents)
					.set({ replacesDocumentId: documentId, updatedAt: new Date() })
					.where(eq(documents.id, replacement.id));
			}
		} catch (e) {
			// The cancellation stands regardless — a replacement can be issued later.
			const msg = e instanceof DocumentError ? e.message : 'unexpected error';
			throw new DocumentError(`Cancelled ${doc.formattedNo}, but could not issue a replacement: ${msg}`);
		}
	}

	await writeAudit({
		hotelId,
		actor,
		action: 'bir.cancel_document',
		entityType: 'document',
		entityId: documentId,
		after: { formattedNo: doc.formattedNo, reason: reason.trim(), replacementId: replacement?.id ?? null }
	});

	return { cancelled: { ...doc, status: 'cancelled' }, replacement };
}

/**
 * Consumes the next serial in the active series **without** issuing a real document
 * — a print failure, wrong data caught before hand-off, a damaged form. The number
 * is recorded as `spoiled` (retained, never reused) so the range stays fully
 * accounted for.
 */
export async function spoilSerial(
	hotelId: string,
	type: DocType,
	reason: string,
	actor: SessionUser | null
): Promise<IssuedDocument> {
	if (!reason.trim()) throw new DocumentError('A reason is required to spoil a serial.');
	const s = await getBirSettings(hotelId);
	const padWidth = s?.serialPadWidth ?? 6;

	const row = await db.transaction(async (tx) => {
		const alloc = await allocateSerial(tx, hotelId, type, padWidth);
		const [inserted] = await tx
			.insert(documents)
			.values({
				hotelId,
				type,
				seriesId: alloc.seriesId,
				serialNo: alloc.serialNo,
				formattedNo: alloc.formattedNo,
				status: 'spoiled',
				snapshot: {},
				spoiledByUserId: actor?.id ?? null,
				spoiledAt: new Date(),
				spoilReason: reason.trim(),
				issuedByUserId: actor?.id ?? null
			})
			.returning();
		return inserted!;
	});

	await writeAudit({
		hotelId,
		actor,
		action: 'bir.spoil_serial',
		entityType: 'document',
		entityId: row.id,
		after: { type, formattedNo: row.formattedNo, reason: reason.trim() }
	});
	return row;
}

export type LiquidationStatus = 'unused' | 'issued' | 'cancelled' | 'spoiled';

export interface LiquidationRow {
	serialFrom: number;
	serialTo: number;
	formattedFrom: string;
	formattedTo: string;
	count: number;
	status: LiquidationStatus;
	documentId: string | null;
	type: DocType | null;
	billToName: string | null;
	grossCentavos: number | null;
	at: Date | null;
	reason: string | null;
	byName: string | null;
}

export interface LiquidationRegister {
	series: DocumentSeries;
	rows: LiquidationRow[];
	summary: { issued: number; cancelled: number; spoiled: number; unused: number; total: number };
}

/** One consumed serial, already resolved to display values — the pure input to `assembleLiquidationRows`. */
export interface LiquidationEntry {
	serialNo: number;
	formattedNo: string;
	status: Exclude<LiquidationStatus, 'unused'>;
	documentId: string | null;
	type: DocType | null;
	billToName: string | null;
	grossCentavos: number | null;
	at: Date | null;
	reason: string | null;
	byName: string | null;
}

/**
 * Pure: walks `serialFrom..serialTo`, emits one row per consumed serial and collapses
 * every run of unused numbers into a single range row, so a 10,000-wide ATP stays
 * readable. No DB — unit-tested directly.
 */
export function assembleLiquidationRows(
	serialFrom: number,
	serialTo: number,
	prefix: string,
	padWidth: number,
	entries: LiquidationEntry[]
): { rows: LiquidationRow[]; summary: LiquidationRegister['summary'] } {
	const bySerial = new Map(entries.map((e) => [e.serialNo, e]));
	const fmt = (n: number) => formatSerial(prefix, n, padWidth);
	const rows: LiquidationRow[] = [];
	const summary = { issued: 0, cancelled: 0, spoiled: 0, unused: 0, total: serialTo - serialFrom + 1 };
	let runStart: number | null = null;

	const flushUnused = (endExclusive: number) => {
		if (runStart === null) return;
		const from = runStart;
		const to = endExclusive - 1;
		const c = to - from + 1;
		summary.unused += c;
		rows.push({
			serialFrom: from,
			serialTo: to,
			formattedFrom: fmt(from),
			formattedTo: fmt(to),
			count: c,
			status: 'unused',
			documentId: null,
			type: null,
			billToName: null,
			grossCentavos: null,
			at: null,
			reason: null,
			byName: null
		});
		runStart = null;
	};

	for (let n = serialFrom; n <= serialTo; n++) {
		const e = bySerial.get(n);
		if (!e) {
			if (runStart === null) runStart = n;
			continue;
		}
		flushUnused(n);
		summary[e.status] += 1;
		rows.push({
			serialFrom: n,
			serialTo: n,
			formattedFrom: e.formattedNo,
			formattedTo: e.formattedNo,
			count: 1,
			status: e.status,
			documentId: e.documentId,
			type: e.type,
			billToName: e.billToName,
			grossCentavos: e.grossCentavos,
			at: e.at,
			reason: e.reason,
			byName: e.byName
		});
	}
	flushUnused(serialTo + 1);
	return { rows, summary };
}

/**
 * Full accounting of one registered serial range: every number from `serialFrom` to
 * `serialTo` with its status.
 */
export async function getLiquidationRegister(
	hotelId: string,
	seriesId: string
): Promise<LiquidationRegister> {
	const [series] = await db
		.select()
		.from(documentSeries)
		.where(and(eq(documentSeries.id, seriesId), eq(documentSeries.hotelId, hotelId)))
		.limit(1);
	if (!series) throw new DocumentError('Series not found.');

	const docs = await db
		.select()
		.from(documents)
		.where(and(eq(documents.hotelId, hotelId), eq(documents.seriesId, seriesId)))
		.orderBy(asc(documents.serialNo));

	const userIds = [
		...new Set(
			docs
				.flatMap((d) => [d.issuedByUserId, d.cancelledByUserId, d.spoiledByUserId])
				.filter((v): v is string => !!v)
		)
	];
	const nameById = new Map<string, string>();
	if (userIds.length) {
		const us = await db
			.select({ id: users.id, name: users.name })
			.from(users)
			.where(inArray(users.id, userIds));
		for (const u of us) nameById.set(u.id, u.name);
	}

	const s = await getBirSettings(hotelId);
	const padWidth = s?.serialPadWidth ?? 6;

	const entries: LiquidationEntry[] = docs.map((d) => {
		const st = d.status as Exclude<LiquidationStatus, 'unused'>;
		const uid =
			st === 'cancelled'
				? d.cancelledByUserId
				: st === 'spoiled'
					? d.spoiledByUserId
					: d.issuedByUserId;
		return {
			serialNo: d.serialNo,
			formattedNo: d.formattedNo,
			status: st,
			documentId: d.id,
			type: d.type,
			billToName: d.billToName,
			grossCentavos:
				st === 'spoiled' ? null : ((d.snapshot as DocumentSnapshot)?.totals?.grossCentavos ?? null),
			at: st === 'cancelled' ? d.cancelledAt : st === 'spoiled' ? d.spoiledAt : d.issuedAt,
			reason: st === 'cancelled' ? d.cancelReason : st === 'spoiled' ? d.spoilReason : null,
			byName: uid ? (nameById.get(uid) ?? null) : null
		};
	});

	const { rows, summary } = assembleLiquidationRows(
		series.serialFrom,
		series.serialTo,
		series.prefix,
		padWidth,
		entries
	);
	return { series, rows, summary };
}
