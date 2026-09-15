import { and, asc, desc, eq, gte, ilike, inArray, lte } from 'drizzle-orm';
import { db } from '../db/index';
import { amenityItems, cashMovements, hotels, standaloneSaleItems, standaloneSales } from '../db/schema/index';
import type { PaymentMethod } from './payments';
import { writeAudit } from '../audit';
import type { SessionUser } from '../auth/session';
import { FinanceError, businessDateFor } from './shared';
import { changeFor } from './calc';
import { recordCashMovement } from './cash';
import { resolvePaymentAccount } from './payments';

export interface StandaloneSaleLineInput {
	/** From the sellable catalog — server re-prices from the catalog, never trusts a
	 *  client-sent price for these. Omit for an ad-hoc line. */
	amenityItemId?: string | null;
	/** Required (and used verbatim) only when `amenityItemId` is omitted. */
	description?: string;
	quantity: number;
	/** Required (and used verbatim) only when `amenityItemId` is omitted. */
	unitPriceCentavos?: number;
}

export interface CreateStandaloneSaleInput {
	hotelId: string;
	lines: StandaloneSaleLineInput[];
	method: PaymentMethod;
	/** Cash only — what the walk-in handed over. Required (and must cover the
	 *  total) for `method: 'cash'`; ignored for every other method, since a quick
	 *  sale has no folio to carry an under-tender forward on. */
	tenderedCentavos?: number | null;
	actor: SessionUser | null;
}

interface ResolvedLine {
	amenityItemId: string | null;
	description: string;
	quantity: number;
	unitPriceCentavos: number;
	lineTotalCentavos: number;
}

/**
 * Records a sale with no booking behind it — a walk-in buying from the sellable
 * catalog with nothing to charge it to. Posts straight to cash-in (category
 * `incidental_sale`), same accountability as any other cash sale (open-shift
 * requirement, shift reconciliation) via the same `resolvePaymentAccount` the
 * front-desk payment path uses. No guest record required.
 */
export async function createStandaloneSale(
	input: CreateStandaloneSaleInput
): Promise<{ saleId: string; totalCentavos: number; changeCentavos: number }> {
	if (input.lines.length === 0) throw new FinanceError('Add at least one item.');

	const [hotel] = await db.select({ timezone: hotels.timezone }).from(hotels).where(eq(hotels.id, input.hotelId)).limit(1);
	if (!hotel) throw new FinanceError('Hotel not found.');
	const businessDate = businessDateFor(hotel.timezone);

	const resolved: ResolvedLine[] = [];
	for (const line of input.lines) {
		if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
			throw new FinanceError('Quantity must be a positive whole number.');
		}
		if (line.amenityItemId) {
			const [item] = await db
				.select()
				.from(amenityItems)
				.where(and(eq(amenityItems.id, line.amenityItemId), eq(amenityItems.hotelId, input.hotelId), eq(amenityItems.isActive, true)))
				.limit(1);
			if (!item) throw new FinanceError('One of the items is no longer available.');
			resolved.push({
				amenityItemId: item.id,
				description: item.name,
				quantity: line.quantity,
				unitPriceCentavos: item.priceCentavos,
				lineTotalCentavos: item.priceCentavos * line.quantity
			});
		} else {
			const description = line.description?.trim();
			if (!description) throw new FinanceError('Give the custom item a description.');
			if (!Number.isInteger(line.unitPriceCentavos) || (line.unitPriceCentavos ?? 0) <= 0) {
				throw new FinanceError('Enter a positive price for the custom item.');
			}
			resolved.push({
				amenityItemId: null,
				description,
				quantity: line.quantity,
				unitPriceCentavos: line.unitPriceCentavos!,
				lineTotalCentavos: line.unitPriceCentavos! * line.quantity
			});
		}
	}
	const totalCentavos = resolved.reduce((s, l) => s + l.lineTotalCentavos, 0);

	let tenderedCentavos: number | null = null;
	let changeCentavos = 0;
	if (input.method === 'cash') {
		if (!Number.isInteger(input.tenderedCentavos) || (input.tenderedCentavos ?? 0) < totalCentavos) {
			throw new FinanceError('Cash tendered must cover the total.');
		}
		tenderedCentavos = input.tenderedCentavos!;
		changeCentavos = changeFor(tenderedCentavos, totalCentavos);
	}

	const { cashAccountId, shiftId } = await resolvePaymentAccount(input.hotelId, input.method);

	const saleId = await db.transaction(async (tx) => {
		const movementId = await recordCashMovement(
			{
				hotelId: input.hotelId,
				businessDate,
				direction: 'in',
				category: 'incidental_sale',
				cashAccountId,
				amountCentavos: totalCentavos,
				sourceType: 'standalone_sale',
				shiftId,
				memo: `Walk-up sale — ${resolved.map((l) => `${l.quantity}x ${l.description}`).join(', ')}`,
				actor: input.actor
			},
			tx
		);

		const [sale] = await tx
			.insert(standaloneSales)
			.values({
				hotelId: input.hotelId,
				businessDate,
				method: input.method,
				cashAccountId,
				shiftId,
				totalCentavos,
				tenderedCentavos,
				changeCentavos,
				cashMovementId: movementId,
				soldByUserId: input.actor?.id ?? null
			})
			.returning({ id: standaloneSales.id });

		await tx.insert(standaloneSaleItems).values(resolved.map((l) => ({ saleId: sale!.id, ...l })));
		await tx.update(cashMovements).set({ sourceId: sale!.id }).where(eq(cashMovements.id, movementId));

		return sale!.id;
	});

	await writeAudit({
		hotelId: input.hotelId,
		actor: input.actor,
		action: 'finance.standalone_sale',
		entityType: 'standalone_sale',
		entityId: saleId,
		after: { totalCentavos, lineCount: resolved.length, method: input.method }
	});

	return { saleId, totalCentavos, changeCentavos };
}

export interface CatalogItem {
	id: string;
	name: string;
	category: string | null;
	priceCentavos: number;
}

/**
 * A "custom item" typed at the quick-sale register becomes a real, reusable
 * catalog entry instead of a one-off line: an exact case-insensitive name match
 * against the hotel's existing (active) items reuses that item's own id and
 * price rather than creating a near-duplicate; anything else inserts a new
 * `amenity_items` row (no category, taxable by the schema's own default) so the
 * next sale of the same thing is one tap, not retyped.
 */
export async function findOrCreateAmenityItem(
	hotelId: string,
	name: string,
	priceCentavos: number
): Promise<{ item: CatalogItem; matchedExisting: boolean }> {
	const trimmed = name.trim();
	if (!trimmed) throw new FinanceError('Enter a name.');
	if (!Number.isInteger(priceCentavos) || priceCentavos <= 0) {
		throw new FinanceError('Enter a positive price.');
	}

	const [existing] = await db
		.select({ id: amenityItems.id, name: amenityItems.name, category: amenityItems.category, priceCentavos: amenityItems.priceCentavos })
		.from(amenityItems)
		.where(and(eq(amenityItems.hotelId, hotelId), eq(amenityItems.isActive, true), ilike(amenityItems.name, trimmed)))
		.limit(1);
	if (existing) return { item: existing, matchedExisting: true };

	const [created] = await db
		.insert(amenityItems)
		.values({ hotelId, name: trimmed, priceCentavos })
		.returning({ id: amenityItems.id, name: amenityItems.name, category: amenityItems.category, priceCentavos: amenityItems.priceCentavos });
	return { item: created!, matchedExisting: false };
}

/** Sales that counted against one specific cashier shift — same convention
 *  `finance/shifts.ts`'s `getShiftReconciliation` already uses for cash movements
 *  (`shiftId` FK match, not a time-window join). A non-cash sale never carries a
 *  `shiftId` (see `createStandaloneSale`), so it never shows up here — shifts are
 *  a cash-drawer concept throughout this app, not a general "who was on duty" log. */
export async function listStandaloneSalesForShift(hotelId: string, shiftId: string, limit = 50) {
	return db
		.select()
		.from(standaloneSales)
		.where(and(eq(standaloneSales.hotelId, hotelId), eq(standaloneSales.shiftId, shiftId)))
		.orderBy(desc(standaloneSales.createdAt))
		.limit(limit);
}

export interface QuickSalesReportRow {
	businessDate: string;
	createdAt: Date;
	itemsSummary: string;
	method: string;
	totalCentavos: number;
}

/** Every quick sale in a business-date range, for the Finance → Reports "Quick
 *  sales" report — one row per sale (not aggregated), same register-tape shape as
 *  the print receipt itself, since each sale is a distinct transaction to verify. */
export async function quickSalesReport(
	hotelId: string,
	from: string,
	to: string
): Promise<{ rows: QuickSalesReportRow[]; totalCentavos: number }> {
	const sales = await db
		.select()
		.from(standaloneSales)
		.where(and(eq(standaloneSales.hotelId, hotelId), gte(standaloneSales.businessDate, from), lte(standaloneSales.businessDate, to)))
		.orderBy(asc(standaloneSales.businessDate), asc(standaloneSales.createdAt));

	const items = sales.length
		? await db
				.select()
				.from(standaloneSaleItems)
				.where(inArray(standaloneSaleItems.saleId, sales.map((s) => s.id)))
		: [];
	const itemsBySale = new Map<string, typeof items>();
	for (const i of items) {
		const arr = itemsBySale.get(i.saleId) ?? [];
		arr.push(i);
		itemsBySale.set(i.saleId, arr);
	}

	const rows = sales.map((s) => ({
		businessDate: s.businessDate,
		createdAt: s.createdAt,
		itemsSummary: (itemsBySale.get(s.id) ?? []).map((i) => `${i.quantity}x ${i.description}`).join(', '),
		method: s.method,
		totalCentavos: s.totalCentavos
	}));
	return { rows, totalCentavos: rows.reduce((sum, r) => sum + r.totalCentavos, 0) };
}

export async function listStandaloneSales(hotelId: string, limit = 100) {
	return db
		.select()
		.from(standaloneSales)
		.where(eq(standaloneSales.hotelId, hotelId))
		.orderBy(desc(standaloneSales.createdAt))
		.limit(limit);
}

export async function getStandaloneSaleItems(saleId: string) {
	return db.select().from(standaloneSaleItems).where(eq(standaloneSaleItems.saleId, saleId));
}
