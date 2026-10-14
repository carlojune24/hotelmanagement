import { and, desc, eq, inArray, ilike, or, sql } from 'drizzle-orm';
import { db } from './db/index';
import {
	auditLog,
	bookings,
	cashMovements,
	diningOrders,
	diningPayments,
	diningReservations,
	documents,
	guests,
	hallBookings,
	orders,
	payments,
	securityDeposits
} from './db/schema/index';
import type { LookupKind } from '../lookup-labels';

/**
 * "Find by number": a staff member types any number they were given (a booking confirmation
 * code, an order or reservation code, an OR/invoice number, a payment or deposit reference) and
 * lands on the thing it identifies, with its activity trail. Read-only, always scoped to one
 * hotel, and each result is only returned to someone who may open the page it leads to.
 */

export type { LookupKind };

export interface AuditRef {
	entityType: string;
	entityId: string;
}

export interface LookupHit {
	key: string;
	kind: LookupKind;
	/** Short heading: "Booking 1A2B3C4D", "Official receipt OR-000042". */
	title: string;
	/** One line of context: guest, status, amount. */
	subtitle: string;
	/** The existing page that shows the whole thing. */
	href: string;
	/** What the signed-in staff member needs for that page. */
	cap: string;
	/** The records whose audit entries make up this result's trail. */
	refs: AuditRef[];
	/** For a dining order or table reservation: its DN-/TB- number, which opens the full trail page. */
	trailRef?: string;
}

const MAX_HITS = 25;
const peso = (c: number) =>
	`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Escapes LIKE wildcards so what staff type is matched literally. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function normaliseQuery(raw: string | null | undefined): string {
	return (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

/**
 * Resolves `raw` against every kind of number the app hands out. `can` says which capabilities
 * the caller holds; a result needing one they lack is left out entirely, so a number never
 * confirms that something exists to someone who may not see it.
 */
export async function resolveNumber(
	hotelId: string,
	hotelSlug: string,
	raw: string,
	can: (cap: string) => boolean
): Promise<LookupHit[]> {
	const q = normaliseQuery(raw);
	if (q.length < 3) return [];
	const upper = q.toUpperCase();
	const esc = likeEscape(q);
	const base = `/${hotelSlug}`;
	const hits: LookupHit[] = [];
	const add = (h: LookupHit) => {
		if (!can(h.cap)) return;
		if (hits.some((x) => x.key === h.key)) return;
		hits.push(h);
	};

	// ---- a booking confirmation code: the first 8 characters of the order id --------------
	const looksLikeBookingCode = /^[0-9a-f]{6,8}$/i.test(q);
	// ---- a dining code with or without its prefix ("DN-YBCV" or just "YBCV") ---------------
	const bare = /^[A-Z0-9]{4}$/.test(upper) ? upper : null;
	const diningCodes = [
		...(upper.startsWith('DN-') ? [upper] : []),
		...(bare ? [`DN-${bare}`] : [])
	];
	const reservationCodes = [
		...(upper.startsWith('TB-') ? [upper] : []),
		...(bare ? [`TB-${bare}`] : [])
	];

	const [
		bookingHits,
		paymentRefHits,
		depositRefHits,
		diningHits,
		diningPaymentHits,
		reservationHits,
		documentHits
	] = await Promise.all([
		looksLikeBookingCode
			? db
					.select({
						id: orders.id,
						status: orders.status,
						total: orders.totalCentavos,
						guest: guests.fullName
					})
					.from(orders)
					.innerJoin(guests, eq(guests.id, orders.guestId))
					.where(and(eq(orders.hotelId, hotelId), sql`${orders.id}::text ilike ${esc + '%'}`))
					.limit(10)
			: [],
		db
			.select({
				orderId: payments.orderId,
				paymentId: payments.id,
				method: payments.method,
				amount: payments.amountCentavos,
				ref: payments.referenceNo
			})
			.from(payments)
			.innerJoin(orders, eq(orders.id, payments.orderId))
			.where(and(eq(orders.hotelId, hotelId), ilike(payments.referenceNo, esc)))
			.limit(10),
		db
			.select({
				depositId: securityDeposits.id,
				orderId: bookings.orderId,
				bookingId: securityDeposits.bookingId,
				amount: securityDeposits.amountCentavos,
				status: securityDeposits.status,
				ref: securityDeposits.referenceNo
			})
			.from(securityDeposits)
			.innerJoin(bookings, eq(bookings.id, securityDeposits.bookingId))
			.where(and(eq(securityDeposits.hotelId, hotelId), ilike(securityDeposits.referenceNo, esc)))
			.limit(10),
		diningCodes.length
			? db
					.select({
						id: diningOrders.id,
						code: diningOrders.code,
						status: diningOrders.status,
						paymentStatus: diningOrders.paymentStatus,
						total: diningOrders.totalCentavos,
						tableLabel: diningOrders.tableLabel,
						orderType: diningOrders.orderType
					})
					.from(diningOrders)
					.where(and(eq(diningOrders.hotelId, hotelId), inArray(diningOrders.code, diningCodes)))
					.limit(10)
			: [],
		db
			.select({
				orderId: diningPayments.orderId,
				ref: diningPayments.referenceNo,
				code: diningOrders.code,
				total: diningOrders.totalCentavos,
				status: diningOrders.status
			})
			.from(diningPayments)
			.innerJoin(diningOrders, eq(diningOrders.id, diningPayments.orderId))
			.where(and(eq(diningOrders.hotelId, hotelId), ilike(diningPayments.referenceNo, esc)))
			.limit(10),
		reservationCodes.length
			? db
					.select({
						id: diningReservations.id,
						code: diningReservations.code,
						status: diningReservations.status,
						guest: diningReservations.guestName,
						party: diningReservations.partySize,
						startsAt: diningReservations.startsAt
					})
					.from(diningReservations)
					.where(and(eq(diningReservations.hotelId, hotelId), inArray(diningReservations.code, reservationCodes)))
					.limit(10)
			: [],
		db
			.select({
				id: documents.id,
				type: documents.type,
				no: documents.formattedNo,
				status: documents.status,
				orderId: documents.orderId,
				diningOrderId: documents.diningOrderId,
				billTo: documents.billToName,
				paymentId: documents.paymentId,
				diningCode: sql<string | null>`(select code from dining_orders where id = ${documents.diningOrderId})`
			})
			.from(documents)
			.where(
				and(
					eq(documents.hotelId, hotelId),
					// the whole number, or (for digits only) its serial at the end of it
					/^\d{4,}$/.test(q)
						? or(ilike(documents.formattedNo, esc), ilike(documents.formattedNo, `%-${esc.padStart(6, '0')}`))
						: ilike(documents.formattedNo, esc)
				)
			)
			.limit(10)
	]);

	for (const o of bookingHits) {
		const code = o.id.slice(0, 8).toUpperCase();
		add({
			key: `booking:${o.id}`,
			kind: 'booking',
			title: `Booking ${code}`,
			subtitle: `${o.guest} · ${o.status.replace(/_/g, ' ')} · ${peso(o.total)}`,
			href: `${base}/management/transactions/${o.id}`,
			cap: 'booking:read',
			refs: [{ entityType: 'order', entityId: o.id }]
		});
	}
	for (const p of paymentRefHits) {
		add({
			key: `payment:${p.paymentId}`,
			kind: 'payment_ref',
			title: `Payment reference ${p.ref}`,
			subtitle: `${p.method.replace(/_/g, ' ')} · ${peso(p.amount)} · booking ${p.orderId.slice(0, 8).toUpperCase()}`,
			href: `${base}/management/transactions/${p.orderId}`,
			cap: 'booking:read',
			refs: [
				{ entityType: 'payment', entityId: p.paymentId },
				{ entityType: 'order', entityId: p.orderId }
			]
		});
	}
	for (const d of depositRefHits) {
		add({
			key: `deposit:${d.depositId}`,
			kind: 'deposit_ref',
			title: `Security deposit ${d.ref}`,
			subtitle: `${d.status} · ${peso(d.amount)} · booking ${d.orderId.slice(0, 8).toUpperCase()}`,
			href: `${base}/management/transactions/${d.orderId}`,
			cap: 'booking:read',
			refs: [
				...(d.bookingId ? [{ entityType: 'booking', entityId: d.bookingId }] : []),
				{ entityType: 'order', entityId: d.orderId }
			]
		});
	}
	for (const d of diningHits) {
		add({
			key: `dining:${d.id}`,
			kind: 'dining_order',
			title: `Dining order ${d.code}`,
			subtitle: `${d.tableLabel ? `Table ${d.tableLabel}` : d.orderType.replace(/_/g, ' ')} · ${d.status.replace(/_/g, ' ')} · ${d.paymentStatus.replace(/_/g, ' ')} · ${peso(d.total)}`,
			href: `${base}/print/bill/order/${d.id}`,
			cap: 'dining:read',
			trailRef: d.code,
			refs: [{ entityType: 'dining_order', entityId: d.id }]
		});
	}
	for (const d of diningPaymentHits) {
		add({
			key: `dining:${d.orderId}`,
			kind: 'dining_payment_ref',
			title: `Dining order ${d.code}`,
			subtitle: `Payment reference ${d.ref} · ${d.status.replace(/_/g, ' ')} · ${peso(d.total)}`,
			href: `${base}/print/bill/order/${d.orderId}`,
			cap: 'dining:read',
			trailRef: d.code,
			refs: [{ entityType: 'dining_order', entityId: d.orderId }]
		});
	}
	for (const r of reservationHits) {
		add({
			key: `reservation:${r.id}`,
			kind: 'dining_reservation',
			title: `Table reservation ${r.code}`,
			subtitle: `${r.guest} · party of ${r.party} · ${r.status.replace(/_/g, ' ')} · ${r.startsAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
			href: `${base}/management/dining/reservations`,
			cap: 'dining:read',
			trailRef: r.code,
			refs: [{ entityType: 'dining_reservation', entityId: r.id }]
		});
	}
	for (const d of documentHits) {
		const isDining = !!d.diningOrderId;
		add({
			key: `document:${d.id}`,
			kind: 'document',
			title: `${d.type === 'invoice' ? 'Invoice' : 'Official receipt'} ${d.no}`,
			subtitle: `${d.status}${d.billTo ? ` · ${d.billTo}` : ''}`,
			href: `${base}/print/${d.type === 'invoice' ? 'invoice' : 'receipt'}/${d.id}`,
			cap: isDining ? 'dining:read' : 'folio:read',
			trailRef: d.diningCode ?? undefined,
			refs: [
				{ entityType: 'document', entityId: d.id },
				...(d.orderId ? [{ entityType: 'order', entityId: d.orderId }] : []),
				...(d.diningOrderId ? [{ entityType: 'dining_order', entityId: d.diningOrderId }] : []),
				...(d.paymentId ? [{ entityType: 'payment', entityId: d.paymentId }] : [])
			]
		});
	}

	// A booking's trail also covers its room lines, hall lines, payments and documents.
	const orderIds = hits.flatMap((h) => h.refs.filter((r) => r.entityType === 'order').map((r) => r.entityId));
	if (orderIds.length) {
		const [rooms, halls, pays, docs] = await Promise.all([
			db.select({ id: bookings.id, orderId: bookings.orderId }).from(bookings).where(and(eq(bookings.hotelId, hotelId), inArray(bookings.orderId, orderIds))),
			db
				.select({ id: hallBookings.id, orderId: hallBookings.orderId })
				.from(hallBookings)
				.innerJoin(orders, eq(orders.id, hallBookings.orderId))
				.where(and(eq(orders.hotelId, hotelId), inArray(hallBookings.orderId, orderIds))),
			db
				.select({ id: payments.id, orderId: payments.orderId })
				.from(payments)
				.innerJoin(orders, eq(orders.id, payments.orderId))
				.where(and(eq(orders.hotelId, hotelId), inArray(payments.orderId, orderIds))),
			db
				.select({ id: documents.id, orderId: documents.orderId })
				.from(documents)
				.where(and(eq(documents.hotelId, hotelId), inArray(documents.orderId, orderIds)))
		]);
		for (const h of hits) {
			const oid = h.refs.find((r) => r.entityType === 'order')?.entityId;
			if (!oid) continue;
			const extra = (type: string, rows: { id: string; orderId: string | null }[]): AuditRef[] =>
				rows.filter((r) => r.orderId === oid).map((r) => ({ entityType: type, entityId: r.id }));
			h.refs.push(...extra('booking', rooms), ...extra('hall_booking', halls), ...extra('payment', pays), ...extra('document', docs));
		}
	}

	// A dining order's trail also covers its table check, reservation, receipts and cash movements; a
	// table reservation's covers its pre-orders and their bills. Same set the trail page reads.
	const diningOrderIds = hits.flatMap((h) => h.refs.filter((r) => r.entityType === 'dining_order').map((r) => r.entityId));
	const diningResIds = hits.flatMap((h) => h.refs.filter((r) => r.entityType === 'dining_reservation').map((r) => r.entityId));
	if (diningOrderIds.length || diningResIds.length) {
		const related = await db
			.select({ id: diningOrders.id, checkId: diningOrders.checkId, reservationId: diningOrders.reservationId })
			.from(diningOrders)
			.where(
				and(
					eq(diningOrders.hotelId, hotelId),
					or(
						diningOrderIds.length ? inArray(diningOrders.id, diningOrderIds) : undefined,
						diningResIds.length ? inArray(diningOrders.reservationId, diningResIds) : undefined
					)
				)
			);
		const relatedIds = related.map((o) => o.id);
		const [docs, moves] = relatedIds.length
			? await Promise.all([
					db.select({ id: documents.id, diningOrderId: documents.diningOrderId }).from(documents).where(and(eq(documents.hotelId, hotelId), inArray(documents.diningOrderId, relatedIds))),
					db
						.select({ id: cashMovements.id, sourceId: cashMovements.sourceId })
						.from(cashMovements)
						.where(and(eq(cashMovements.hotelId, hotelId), eq(cashMovements.sourceType, 'dining_order'), inArray(cashMovements.sourceId, relatedIds)))
				])
			: [[], []];
		for (const h of hits) {
			const own = h.refs.filter((r) => r.entityType === 'dining_order').map((r) => r.entityId);
			const res = h.refs.filter((r) => r.entityType === 'dining_reservation').map((r) => r.entityId);
			const mine = related.filter((o) => own.includes(o.id) || (o.reservationId && res.includes(o.reservationId)));
			const ids = new Set(mine.map((o) => o.id));
			const add = (type: string, id: string | null | undefined) => {
				if (id && !h.refs.some((r) => r.entityType === type && r.entityId === id)) h.refs.push({ entityType: type, entityId: id });
			};
			for (const o of mine) {
				add('dining_order', o.id);
				add('dining_table_check', o.checkId);
				if (own.includes(o.id)) add('dining_reservation', o.reservationId);
			}
			for (const d of docs) if (d.diningOrderId && ids.has(d.diningOrderId)) add('document', d.id);
			for (const m of moves) if (m.sourceId && ids.has(m.sourceId)) add('cash_movement', m.id);
		}
	}

	return hits.slice(0, MAX_HITS);
}

export interface TrailEntry {
	id: string;
	at: string;
	actor: string | null;
	action: string;
	entityType: string;
	entityId: string | null;
	/** Only filled for hotel admins; everyone else sees who did what and when, not the data. */
	before: unknown;
	after: unknown;
}

/**
 * The audit entries recorded against any of `refs`, newest first. Scoped to the hotel, so an id
 * from another hotel can never surface here. `details` controls whether the before/after data
 * comes along; it should be true only for hotel admins, as in the audit log viewer.
 */
export async function auditTrail(
	hotelId: string,
	refs: AuditRef[],
	opts: { details: boolean; limit?: number }
): Promise<TrailEntry[]> {
	const byType = new Map<string, Set<string>>();
	for (const r of refs) {
		if (!byType.has(r.entityType)) byType.set(r.entityType, new Set());
		byType.get(r.entityType)!.add(r.entityId);
	}
	if (byType.size === 0) return [];

	const rows = await db
		.select()
		.from(auditLog)
		.where(
			and(
				eq(auditLog.hotelId, hotelId),
				or(
					...[...byType.entries()].map(([type, ids]) =>
						and(eq(auditLog.entityType, type), inArray(auditLog.entityId, [...ids]))
					)
				)
			)
		)
		.orderBy(desc(auditLog.createdAt))
		.limit(opts.limit ?? 150);

	return rows.map((r) => ({
		id: r.id,
		at: r.createdAt.toISOString(),
		actor: r.actorLabel,
		action: r.action,
		entityType: r.entityType,
		entityId: r.entityId,
		before: opts.details ? r.before : null,
		after: opts.details ? r.after : null
	}));
}
