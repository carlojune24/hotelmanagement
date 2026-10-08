import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from './db/index';
import {
	bookingRooms,
	bookings,
	diningItems,
	diningOrders,
	folioCharges,
	folios,
	guests,
	orders,
	roomAssignments,
	rooms
} from './db/schema/index';
import { writeAudit } from './audit';
import type { SessionUser } from './auth/session';
import { businessDateFor } from './finance/shared';
import { ensureFolio, voidFolioCharge, FolioError } from './folio';
import { hotels } from './db/schema/index';
import { OrderError } from './dining-orders';

type Actor = SessionUser | null;

export interface InHouseGuest {
	bookingId: string;
	roomNumber: string;
	guestName: string;
	/** Same short code the front desk shows for the booking. */
	bookingCode: string;
	checkOut: string;
}

/** Guests staying right now (checked in), with their room, for the "charge to room" picker.
 *  Only this hotel's checked-in room stays; a checked-out or merely confirmed booking never appears. */
export async function listInHouseGuests(hotelId: string): Promise<InHouseGuest[]> {
	const rows = await db
		.select({
			bookingId: bookings.id,
			orderId: bookings.orderId,
			checkOut: bookings.checkOut,
			guestName: guests.fullName,
			roomNumber: rooms.roomNumber
		})
		.from(bookings)
		.innerJoin(orders, eq(orders.id, bookings.orderId))
		.innerJoin(guests, eq(guests.id, orders.guestId))
		.innerJoin(bookingRooms, eq(bookingRooms.bookingId, bookings.id))
		.innerJoin(roomAssignments, eq(roomAssignments.bookingRoomId, bookingRooms.id))
		.innerJoin(rooms, eq(rooms.id, roomAssignments.roomId))
		.where(and(eq(bookings.hotelId, hotelId), eq(bookings.status, 'checked_in')))
		.orderBy(asc(rooms.roomNumber));

	const byBooking = new Map<string, InHouseGuest>();
	for (const r of rows) {
		const existing = byBooking.get(r.bookingId);
		if (existing) {
			if (!existing.roomNumber.split(', ').includes(r.roomNumber)) existing.roomNumber += `, ${r.roomNumber}`;
		} else {
			byBooking.set(r.bookingId, {
				bookingId: r.bookingId,
				roomNumber: r.roomNumber,
				guestName: r.guestName,
				bookingCode: r.orderId.slice(0, 8).toUpperCase(),
				checkOut: r.checkOut
			});
		}
	}
	return [...byBooking.values()];
}

const isDuplicate = (e: unknown) =>
	(e as { code?: string })?.code === '23505' || (e as { cause?: { code?: string } })?.cause?.code === '23505';

/**
 * Charges a dining order to an in-house guest's room: ONE line on their room folio, for the order's
 * VAT-inclusive total (the VAT is split out of it so the invoice shows the right tax). The order is
 * marked `room_charged` and carries the room, booking and guest so staff can trace it. Nothing is
 * paid now: the guest settles it with the rest of the bill, and Finance books the dining income at
 * that point. Only a checked-in guest with an open folio can be charged; an order that is waiting
 * for online payment, already paid, cancelled or already on a bill cannot.
 */
export async function chargeDiningOrderToRoom(args: {
	hotelId: string;
	orderId: string;
	bookingId: string;
	actor: Actor;
}): Promise<{ chargeId: string; roomLabel: string; guestName: string; bookingCode: string }> {
	const inHouse = (await listInHouseGuests(args.hotelId)).find((g) => g.bookingId === args.bookingId);
	if (!inHouse) throw new OrderError('That guest is not checked in, so their room cannot be charged.');

	const [hotel] = await db.select({ timezone: hotels.timezone }).from(hotels).where(eq(hotels.id, args.hotelId)).limit(1);
	const businessDate = businessDateFor(hotel?.timezone ?? 'Asia/Manila');

	let chargeId: string;
	try {
		chargeId = await db.transaction(async (tx) => {
			const [order] = await tx
				.select()
				.from(diningOrders)
				.where(and(eq(diningOrders.id, args.orderId), eq(diningOrders.hotelId, args.hotelId)))
				.for('update');
			if (!order) throw new OrderError('That order could not be found.');
			if (order.status === 'cancelled') throw new OrderError('A cancelled order cannot be charged to a room.');
			if (order.status === 'pending_payment') throw new OrderError('This order is waiting for the guest to pay online.');
			if (order.paymentStatus === 'room_charged') throw new OrderError('This order is already charged to a room.');
			if (order.paymentStatus !== 'unpaid') throw new OrderError('This order has already been paid.');
			if (order.totalCentavos <= 0) throw new OrderError('This order has nothing to charge.');

			const folioId = await ensureFolio(tx, args.hotelId, { kind: 'room', bookingId: args.bookingId });
			const [folio] = await tx.select({ status: folios.status }).from(folios).where(eq(folios.id, folioId)).limit(1);
			if (folio?.status !== 'open') throw new OrderError("This guest's bill is closed. Charge it another way.");

			const [venue] = await tx.select({ title: diningItems.title }).from(diningItems).where(eq(diningItems.id, order.diningItemId)).limit(1);
			const [charge] = await tx
				.insert(folioCharges)
				.values({
					folioId,
					description: `Dining ${order.code}${venue ? `, ${venue.title}` : ''}`,
					quantity: 1,
					// Menu prices include VAT: show the VAT-exclusive base plus the VAT, so the line still totals the order.
					unitPriceCentavos: order.totalCentavos - order.vatCentavos,
					taxCentavos: order.vatCentavos,
					totalCentavos: order.totalCentavos,
					source: 'dining',
					diningOrderId: order.id,
					addedByUserId: args.actor?.id ?? null
				})
				.returning({ id: folioCharges.id });

			await tx
				.update(diningOrders)
				.set({
					paymentStatus: 'room_charged',
					bookingId: args.bookingId,
					roomLabel: inHouse.roomNumber,
					folioChargeId: charge!.id,
					businessDate,
					guestName: order.guestName ?? inHouse.guestName,
					updatedAt: new Date()
				})
				.where(eq(diningOrders.id, order.id));
			return charge!.id;
		});
	} catch (e) {
		if (isDuplicate(e)) throw new OrderError('This order is already charged to a room.');
		if (e instanceof FolioError) throw new OrderError(e.message);
		throw e;
	}

	await writeAudit({
		hotelId: args.hotelId,
		actor: args.actor,
		action: 'dining_order.room_charge',
		entityType: 'dining_order',
		entityId: args.orderId,
		after: { bookingId: args.bookingId, room: inHouse.roomNumber, chargeId }
	});
	return { chargeId, roomLabel: inHouse.roomNumber, guestName: inHouse.guestName, bookingCode: inHouse.bookingCode };
}

/**
 * Takes a dining order off a guest's room bill (a mistake, or the guest would rather pay now). The
 * folio line is voided and the order goes back to unpaid. Refused once any part of the guest's dining
 * charges has been paid, or after check-out: those are corrected from the folio by a manager.
 */
export async function undoDiningRoomCharge(args: { hotelId: string; orderId: string; reason: string; actor: Actor }): Promise<void> {
	const reason = args.reason.trim();
	if (!reason) throw new OrderError('Give a reason for taking this off the room bill.');
	const [order] = await db
		.select()
		.from(diningOrders)
		.where(and(eq(diningOrders.id, args.orderId), eq(diningOrders.hotelId, args.hotelId)))
		.limit(1);
	if (!order) throw new OrderError('That order could not be found.');
	if (order.paymentStatus !== 'room_charged' || !order.folioChargeId || !order.bookingId) {
		throw new OrderError('This order is not charged to a room.');
	}

	const [folio] = await db
		.select({ id: folios.id, status: folios.status })
		.from(folios)
		.where(and(eq(folios.bookingId, order.bookingId), eq(folios.hotelId, args.hotelId)))
		.limit(1);
	if (!folio) throw new OrderError('That guest\'s bill could not be found.');
	if (folio.status !== 'open') throw new OrderError('The guest has checked out. A manager must adjust the bill from the folio.');

	// Part of the dining charges already settled: voiding would leave the folio in credit.
	const [{ settled } = { settled: 0 }] = await db.execute(sql`
		select (
			coalesce((select sum(p.dining_centavos) from payments p where p.folio_id = ${folio.id} and p.voided_at is null), 0) +
			coalesce((select sum(a.dining_centavos) from payment_allocations a join payments p on p.id = a.payment_id where a.booking_id = ${order.bookingId} and p.voided_at is null), 0)
		)::bigint as settled
	`).then((r) => r as unknown as { settled: number }[]);
	if (Number(settled) > 0) {
		throw new OrderError('Part of this guest\'s dining charges has already been paid. A manager must adjust the bill from the folio.');
	}

	try {
		// This also puts the order back to unpaid (see `voidFolioCharge`).
		await voidFolioCharge(args.hotelId, { kind: 'room', bookingId: order.bookingId }, order.folioChargeId, `Dining ${order.code}: ${reason}`, args.actor);
	} catch (e) {
		if (e instanceof FolioError) throw new OrderError(e.message);
		throw e;
	}
	await writeAudit({
		hotelId: args.hotelId,
		actor: args.actor,
		action: 'dining_order.undo_room_charge',
		entityType: 'dining_order',
		entityId: order.id,
		after: { reason, bookingId: order.bookingId }
	});
}
