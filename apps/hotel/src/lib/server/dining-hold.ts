import { sql } from 'drizzle-orm';
import { diningOrders } from './db/schema/index';

/**
 * A pre-order made for a table reservation that is still ahead is not the kitchen's yet: it was
 * placed (and usually paid) days before the guest sits down. This is the rule for when it becomes
 * the kitchen's, as SQL so every place that asks "what is the kitchen cooking?" agrees:
 *
 *  - while the reservation is `pending` or `confirmed` and is more than the venue's prep time away,
 *    the order is held back;
 *  - from `prepMinutes` before the booking time, or the moment the party is seated, it is released.
 *
 * It only ever *hides* an order from the kitchen's own views. The order keeps its status, so the
 * Orders board, the guest's tracking page, payments and refunds all see it exactly as before.
 * Takeaway orders, walk-ins, QR orders and anything not tied to a reservation are never held.
 */
export const heldForReservation = sql`(
	${diningOrders.orderType} = 'pre_order'
	and ${diningOrders.reservationId} is not null
	and exists (
		select 1
		from dining_reservations hr
		join dining_items hv on hv.id = ${diningOrders.diningItemId}
		where hr.id = ${diningOrders.reservationId}
		  and hr.status in ('pending', 'confirmed')
		  and now() < hr.starts_at - make_interval(mins => hv.prep_minutes)
	)
)`;

/** The kitchen's view: everything except what is still held for a reservation that is not due. */
export const releasedToKitchen = sql`not ${heldForReservation}`;
