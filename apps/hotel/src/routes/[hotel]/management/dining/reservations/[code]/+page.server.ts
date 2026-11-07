import { error } from '@sveltejs/kit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import {
	bookings,
	diningItems,
	diningOrderItemAddons,
	diningOrderItems,
	diningOrders,
	diningPayments,
	diningReservations,
	diningReservationTables,
	diningTables,
	documents,
	users
} from '$lib/server/db/schema/index';
import { requireCap } from '$lib/server/auth/rbac';
import type { PageServerLoad } from './$types';

/** One table reservation in full: the booking, what was pre-ordered, and every peso paid or refunded. */
export const load: PageServerLoad = async ({ locals, params }) => {
	requireCap(locals.user, locals.role, 'dining:read');
	const hotelId = locals.hotel!.id;

	const [row] = await db
		.select({ r: diningReservations, venueTitle: diningItems.title, bookingOrderId: bookings.orderId, createdBy: users.name })
		.from(diningReservations)
		.innerJoin(diningItems, eq(diningItems.id, diningReservations.diningItemId))
		.leftJoin(bookings, eq(bookings.id, diningReservations.bookingId))
		.leftJoin(users, eq(users.id, diningReservations.createdByUserId))
		.where(and(eq(diningReservations.hotelId, hotelId), eq(diningReservations.code, params.code.toUpperCase())))
		.limit(1);
	if (!row) error(404, 'Reservation not found');
	const r = row.r;

	const tables = await db
		.select({ name: diningTables.name })
		.from(diningReservationTables)
		.innerJoin(diningTables, eq(diningTables.id, diningReservationTables.tableId))
		.where(eq(diningReservationTables.reservationId, r.id));

	// Every order on this reservation: the pre-order paid online, plus anything added at the table.
	const orders = await db
		.select()
		.from(diningOrders)
		.where(and(eq(diningOrders.hotelId, hotelId), eq(diningOrders.reservationId, r.id)))
		.orderBy(asc(diningOrders.createdAt));
	const orderIds = orders.map((o) => o.id);

	const [items, payments, docs] = orderIds.length
		? await Promise.all([
				db.select().from(diningOrderItems).where(inArray(diningOrderItems.orderId, orderIds)).orderBy(asc(diningOrderItems.sortOrder)),
				db
					.select()
					.from(diningPayments)
					.where(and(eq(diningPayments.hotelId, hotelId), inArray(diningPayments.orderId, orderIds)))
					.orderBy(asc(diningPayments.createdAt)),
				db
					.select({ id: documents.id, orderId: documents.diningOrderId, type: documents.type, formattedNo: documents.formattedNo, status: documents.status, issuedAt: documents.issuedAt })
					.from(documents)
					.where(and(eq(documents.hotelId, hotelId), inArray(documents.diningOrderId, orderIds)))
					.orderBy(asc(documents.createdAt))
			])
		: [[], [], []];
	const addons = items.length
		? await db
				.select({ orderItemId: diningOrderItemAddons.orderItemId, name: diningOrderItemAddons.name, priceCentavos: diningOrderItemAddons.priceCentavos })
				.from(diningOrderItemAddons)
				.where(inArray(diningOrderItemAddons.orderItemId, items.map((i) => i.id)))
		: [];

	const live = orders.filter((o) => o.status !== 'cancelled');
	const orderedCentavos = live.reduce((s, o) => s + o.totalCentavos, 0);
	const paidCentavos = orders.filter((o) => o.paymentStatus === 'paid').reduce((s, o) => s + o.totalCentavos, 0);
	const refundedCentavos = payments.filter((p) => p.kind === 'refund' && p.status === 'paid').reduce((s, p) => s + p.amountCentavos, 0);
	// Same rule as the guest's ticket: a cancelled order that was paid is owed back, less what was refunded.
	const owedBack = orders.filter((o) => o.status === 'cancelled' && o.paymentStatus === 'paid').reduce((s, o) => s + o.totalCentavos, 0);
	const refundDueCentavos = Math.max(0, owedBack - refundedCentavos);
	const unpaidCentavos = live.filter((o) => o.paymentStatus === 'unpaid').reduce((s, o) => s + o.totalCentavos, 0);

	const codeOf = new Map(orders.map((o) => [o.id, o.code]));
	return {
		timezone: locals.hotel!.timezone,
		reservation: {
			id: r.id,
			code: r.code,
			status: r.status,
			source: r.source,
			guestName: r.guestName,
			guestPhone: r.guestPhone,
			guestEmail: r.guestEmail,
			partySize: r.partySize,
			startsAt: r.startsAt.toISOString(),
			endsAt: r.endsAt.toISOString(),
			remarks: r.remarks,
			venueTitle: row.venueTitle,
			tables: tables.map((t) => t.name),
			bookingOrderId: row.bookingOrderId,
			createdBy: row.createdBy,
			createdAt: r.createdAt.toISOString(),
			cancelledAt: r.cancelledAt?.toISOString() ?? null
		},
		orders: orders.map((o) => ({
			id: o.id,
			code: o.code,
			orderType: o.orderType,
			status: o.status,
			paymentStatus: o.paymentStatus,
			paymentMethod: o.paymentMethod,
			paymentReferenceNo: o.paymentReferenceNo,
			totalCentavos: o.totalCentavos,
			vatCentavos: o.vatCentavos,
			paidAt: o.paidAt?.toISOString() ?? null,
			cancelReason: o.cancelReason,
			remarks: o.remarks,
			createdAt: o.createdAt.toISOString(),
			lines: items
				.filter((i) => i.orderId === o.id)
				.map((i) => ({
					id: i.id,
					name: i.name,
					quantity: i.quantity,
					unitCentavos: i.unitPriceCentavos + i.addonsCentavos,
					lineTotalCentavos: i.lineTotalCentavos,
					remarks: i.remarks,
					addons: addons.filter((a) => a.orderItemId === i.id).map((a) => a.name)
				}))
		})),
		payments: payments.map((p) => ({
			id: p.id,
			orderCode: codeOf.get(p.orderId) ?? '',
			kind: p.kind,
			status: p.status,
			provider: p.provider,
			method: p.method,
			amountCentavos: p.amountCentavos,
			reference: p.referenceNo ?? p.paymongoPaymentId ?? null,
			note: p.note,
			proofUrl: p.proofUrl,
			at: (p.paidAt ?? p.createdAt).toISOString()
		})),
		receipts: docs.map((d) => ({ ...d, orderCode: d.orderId ? (codeOf.get(d.orderId) ?? '') : '', issuedAt: d.issuedAt.toISOString() })),
		totals: { orderedCentavos, paidCentavos, refundedCentavos, refundDueCentavos, unpaidCentavos }
	};
};
