import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index';
import { amenityItems, cashMovements, hotels, standaloneSaleItems, standaloneSales } from '../db/schema/index';
import type { PaymentMethod } from './payments';
import { writeAudit } from '../audit';
import type { SessionUser } from '../auth/session';
import { FinanceError, businessDateFor } from './shared';
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
export async function createStandaloneSale(input: CreateStandaloneSaleInput): Promise<{ saleId: string }> {
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

	return { saleId };
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
