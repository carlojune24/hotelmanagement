import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db/index';
import {
	diningItems,
	diningOrderItems,
	diningOrderMessages,
	diningOrders,
	diningReservations
} from './db/schema/index';
import { threadKind, type ThreadKind } from '../dining-messages';

/** One conversation in the Dining inbox: a guest talking to the restaurant about one order. */
export interface MessageThread {
	orderId: string;
	kind: ThreadKind;
	code: string;
	venueTitle: string;
	guestName: string | null;
	guestPhone: string | null;
	status: string;
	paymentStatus: string;
	totalCentavos: number;
	fulfilment: 'pickup' | 'delivery';
	deliveryAddress: string | null;
	riderName: string | null;
	outForDeliveryAt: string | null;
	pickupAt: string | null;
	tableLabel: string | null;
	reservation: { code: string; startsAt: string; partySize: number; status: string } | null;
	messageCount: number;
	unread: number;
	lastAt: string;
	lastBody: string;
	lastFrom: string;
}

/** Newest conversation first. Orders with no messages are not listed. */
export async function listMessageThreads(hotelId: string, limit = 200): Promise<MessageThread[]> {
	const unread = sql<number>`count(*) filter (where ${diningOrderMessages.direction} = 'guest' and ${diningOrderMessages.readAt} is null)::int`;
	const total = sql<number>`count(*)::int`;
	const lastAt = sql<string>`max(${diningOrderMessages.createdAt})`;

	const rows = await db
		.select({
			orderId: diningOrders.id,
			code: diningOrders.code,
			source: diningOrders.source,
			orderType: diningOrders.orderType,
			fulfilment: diningOrders.fulfilment,
			deliveryAddress: diningOrders.deliveryAddress,
			riderName: diningOrders.riderName,
			outForDeliveryAt: diningOrders.outForDeliveryAt,
			pickupAt: diningOrders.pickupAt,
			tableLabel: diningOrders.tableLabel,
			guestName: diningOrders.guestName,
			guestPhone: diningOrders.guestPhone,
			status: diningOrders.status,
			paymentStatus: diningOrders.paymentStatus,
			totalCentavos: diningOrders.totalCentavos,
			reservationId: diningOrders.reservationId,
			venueTitle: diningItems.title,
			reservationCode: diningReservations.code,
			reservationStartsAt: diningReservations.startsAt,
			reservationParty: diningReservations.partySize,
			reservationStatus: diningReservations.status,
			messageCount: total,
			unread,
			lastAt
		})
		.from(diningOrderMessages)
		.innerJoin(diningOrders, eq(diningOrders.id, diningOrderMessages.orderId))
		.innerJoin(diningItems, eq(diningItems.id, diningOrders.diningItemId))
		.leftJoin(diningReservations, eq(diningReservations.id, diningOrders.reservationId))
		.where(eq(diningOrderMessages.hotelId, hotelId))
		.groupBy(diningOrders.id, diningItems.id, diningReservations.id)
		.orderBy(desc(sql`max(${diningOrderMessages.createdAt})`))
		.limit(limit);
	if (rows.length === 0) return [];

	// The last line of each conversation, for the list preview.
	const last = await db
		.selectDistinctOn([diningOrderMessages.orderId], {
			orderId: diningOrderMessages.orderId,
			body: diningOrderMessages.body,
			direction: diningOrderMessages.direction
		})
		.from(diningOrderMessages)
		.where(and(eq(diningOrderMessages.hotelId, hotelId), inArray(diningOrderMessages.orderId, rows.map((r) => r.orderId))))
		.orderBy(diningOrderMessages.orderId, desc(diningOrderMessages.createdAt));
	const lastBy = new Map(last.map((l) => [l.orderId, l]));

	return rows.map((r) => ({
		orderId: r.orderId,
		kind: threadKind({ source: r.source, orderType: r.orderType, fulfilment: r.fulfilment, reservationId: r.reservationId }),
		code: r.code,
		venueTitle: r.venueTitle,
		guestName: r.guestName,
		guestPhone: r.guestPhone,
		status: r.status,
		paymentStatus: r.paymentStatus,
		totalCentavos: r.totalCentavos,
		fulfilment: r.fulfilment === 'delivery' ? 'delivery' : 'pickup',
		deliveryAddress: r.deliveryAddress,
		riderName: r.riderName,
		outForDeliveryAt: r.outForDeliveryAt?.toISOString() ?? null,
		pickupAt: r.pickupAt?.toISOString() ?? null,
		tableLabel: r.tableLabel,
		reservation:
			r.reservationCode && r.reservationStartsAt
				? {
						code: r.reservationCode,
						startsAt: new Date(r.reservationStartsAt).toISOString(),
						partySize: r.reservationParty ?? 0,
						status: r.reservationStatus ?? ''
					}
				: null,
		messageCount: Number(r.messageCount),
		unread: Number(r.unread),
		lastAt: new Date(r.lastAt).toISOString(),
		lastBody: lastBy.get(r.orderId)?.body ?? '',
		lastFrom: lastBy.get(r.orderId)?.direction ?? 'guest'
	}));
}

export interface ThreadMessage {
	id: string;
	direction: string;
	body: string;
	createdAt: string;
}

/** The messages and dishes of one conversation, oldest message first. Null when it is not this hotel's. */
export async function getThreadDetail(
	hotelId: string,
	orderId: string
): Promise<{ messages: ThreadMessage[]; items: { id: string; name: string; quantity: number }[] } | null> {
	const [order] = await db
		.select({ id: diningOrders.id })
		.from(diningOrders)
		.where(and(eq(diningOrders.id, orderId), eq(diningOrders.hotelId, hotelId)))
		.limit(1);
	if (!order) return null;
	const [messages, items] = await Promise.all([
		db
			.select({
				id: diningOrderMessages.id,
				direction: diningOrderMessages.direction,
				body: diningOrderMessages.body,
				createdAt: diningOrderMessages.createdAt
			})
			.from(diningOrderMessages)
			.where(and(eq(diningOrderMessages.hotelId, hotelId), eq(diningOrderMessages.orderId, order.id)))
			.orderBy(asc(diningOrderMessages.createdAt)),
		db
			.select({ id: diningOrderItems.id, name: diningOrderItems.name, quantity: diningOrderItems.quantity })
			.from(diningOrderItems)
			.where(eq(diningOrderItems.orderId, order.id))
			.orderBy(asc(diningOrderItems.name))
	]);
	return {
		messages: messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
		items
	};
}

/** Guest messages nobody on staff has opened yet, for the badge on the Messages tab. */
export async function countUnreadDiningMessages(hotelId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(diningOrderMessages)
		.where(
			and(
				eq(diningOrderMessages.hotelId, hotelId),
				eq(diningOrderMessages.direction, 'guest'),
				sql`${diningOrderMessages.readAt} is null`
			)
		);
	return Number(row?.n ?? 0);
}
