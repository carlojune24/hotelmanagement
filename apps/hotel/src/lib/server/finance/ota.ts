import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db/index';
import { orders, receivables } from '../db/schema/index';
import type { SessionUser } from '../auth/session';
import { FinanceError, pesos } from './shared';
import { settleReceivable, writeOffReceivable } from './receivables';

export interface OtaPayoutItem {
	receivableId: string;
	/** What the OTA actually paid for this booking. The rest of the receivable is the OTA's commission. */
	netReceivedCentavos: number;
}

/**
 * The OTA paid a statement covering several bookings. Per booking: the net received is collected into the
 * bank account through `settleReceivable` (cash-in as room revenue, so revenue is reported net of
 * commission), then what is left on the receivable is written off as the OTA's commission. A write-off
 * posts nothing, so no journal entry is needed.
 *
 * shortcut: each booking is two transactions (collect, then write off), not one. If the write-off fails
 * the receivable stays `partial` and the payout can simply be run again for the remainder.
 */
export async function recordOtaPayout(input: {
	hotelId: string;
	statementRef: string;
	items: OtaPayoutItem[];
	actor: SessionUser | null;
}): Promise<{ collectedCentavos: number; commissionCentavos: number }> {
	const statementRef = input.statementRef.trim();
	if (!statementRef) throw new FinanceError("Enter the OTA's statement or payment reference.");
	if (input.items.length === 0) throw new FinanceError('Tick at least one booking this payout covers.');
	const ids = input.items.map((i) => i.receivableId);
	if (new Set(ids).size !== ids.length) throw new FinanceError('A booking is listed twice.');

	// Validate everything before moving any money.
	const rows = await db
		.select({ id: receivables.id, status: receivables.status, outstanding: receivables.outstandingCentavos, billToName: receivables.billToName })
		.from(receivables)
		.innerJoin(orders, eq(orders.id, receivables.orderId))
		.where(and(eq(receivables.hotelId, input.hotelId), inArray(receivables.id, ids), isNotNull(orders.otaName)));
	const byId = new Map(rows.map((r) => [r.id, r]));
	for (const item of input.items) {
		const r = byId.get(item.receivableId);
		if (!r) throw new FinanceError('One of the bookings is not an OTA receivable of this hotel.');
		if (r.status !== 'open' && r.status !== 'partial') throw new FinanceError(`${r.billToName}: this receivable is already closed.`);
		if (!Number.isInteger(item.netReceivedCentavos) || item.netReceivedCentavos <= 0)
			throw new FinanceError('Enter the amount received for every ticked booking.');
		if (item.netReceivedCentavos > r.outstanding)
			throw new FinanceError(`The OTA cannot have paid more than the ${pesos(r.outstanding)} still due on a booking.`);
	}

	let collected = 0;
	let commission = 0;
	for (const item of input.items) {
		const { outstandingCentavos } = await settleReceivable({
			hotelId: input.hotelId,
			receivableId: item.receivableId,
			method: 'bank_transfer',
			amountCentavos: item.netReceivedCentavos,
			referenceNo: statementRef,
			actor: input.actor
		});
		collected += item.netReceivedCentavos;
		if (outstandingCentavos > 0) {
			await writeOffReceivable(input.hotelId, item.receivableId, `OTA commission (statement ${statementRef})`, input.actor);
			commission += outstandingCentavos;
		}
	}
	return { collectedCentavos: collected, commissionCentavos: commission };
}
