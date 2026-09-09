import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index';
import { bookings, emailLog, guests, hallBookings, orders } from '../db/schema/index';
import type { EmailStatus, EmailType } from '../db/schema/index';

export interface EmailLogLine {
	id: string;
	createdAt: Date;
	type: EmailType;
	status: EmailStatus;
	toAddress: string;
	subject: string;
	error: string | null;
	messageId: string | null;
	orderId: string | null;
	guestName: string | null;
	orderStatus: string | null;
	/** Where to link on the Reservations detail page, when the order still has a line. */
	bookingKind: 'room' | 'hall' | null;
	bookingId: string | null;
}

/**
 * Every transactional email the app has tried to send for a hotel, newest first
 * — the staff-facing view of `email_log`. Each row resolves back to the guest
 * and to a Reservations detail link so staff can jump straight to the booking.
 */
export async function listEmailLog(hotelId: string, limit = 300): Promise<EmailLogLine[]> {
	const rows = await db
		.select({
			id: emailLog.id,
			createdAt: emailLog.createdAt,
			type: emailLog.type,
			status: emailLog.status,
			toAddress: emailLog.toAddress,
			subject: emailLog.subject,
			error: emailLog.error,
			messageId: emailLog.messageId,
			orderId: emailLog.orderId,
			guestName: guests.fullName,
			orderStatus: orders.status
		})
		.from(emailLog)
		.leftJoin(orders, eq(orders.id, emailLog.orderId))
		.leftJoin(guests, eq(guests.id, orders.guestId))
		.where(eq(emailLog.hotelId, hotelId))
		.orderBy(desc(emailLog.createdAt))
		.limit(limit);

	const orderIds = [...new Set(rows.map((r) => r.orderId).filter((v): v is string => Boolean(v)))];
	const bookingByOrder = new Map<string, string>();
	const hallByOrder = new Map<string, string>();
	if (orderIds.length > 0) {
		const [bks, hbs] = await Promise.all([
			db
				.select({ id: bookings.id, orderId: bookings.orderId })
				.from(bookings)
				.where(inArray(bookings.orderId, orderIds)),
			db
				.select({ id: hallBookings.id, orderId: hallBookings.orderId })
				.from(hallBookings)
				.where(inArray(hallBookings.orderId, orderIds))
		]);
		for (const b of bks) if (!bookingByOrder.has(b.orderId)) bookingByOrder.set(b.orderId, b.id);
		for (const h of hbs) if (!hallByOrder.has(h.orderId)) hallByOrder.set(h.orderId, h.id);
	}

	return rows.map((r) => {
		const roomId = r.orderId ? bookingByOrder.get(r.orderId) : undefined;
		const hallId = r.orderId ? hallByOrder.get(r.orderId) : undefined;
		return {
			...r,
			bookingKind: roomId ? ('room' as const) : hallId ? ('hall' as const) : null,
			bookingId: roomId ?? hallId ?? null
		};
	});
}
