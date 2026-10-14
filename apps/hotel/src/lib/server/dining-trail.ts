import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { db } from './db/index';
import {
	auditLog,
	cashMovements,
	diningItems,
	diningOrderItems,
	diningOrderMessages,
	diningOrders,
	diningPayments,
	diningReservationTables,
	diningReservations,
	diningTableChecks,
	diningTables,
	documents,
	users
} from './db/schema/index';
import { actionLabel, actorOf, detailOf, method, num, obj, peso, str, words, type ActorKind } from '../audit-labels';

/**
 * The full, start-to-finish record of one dining tracking number (an order `DN-…` or a table
 * reservation `TB-…`): who did each step and when, with the money and the documents.
 *
 * It is built in two layers so old data helps too. Audit entries (richer from this release on)
 * carry the actor, where the request came from and the data. Everything the tables already hold
 * (order timestamps, kitchen line times, payments, messages, cash movements, documents, table
 * checks) fills in what the audit log never recorded, and is dropped wherever an audit entry
 * already describes the same step, so nothing is listed twice. Nothing here needs a backfill.
 *
 * Written for dining but generic in shape: a room or hall booking trail can reuse the event type.
 */

export interface TrailActor {
	kind: ActorKind | 'unknown';
	label: string;
}

export interface TrailEvent {
	/** ISO timestamp. */
	at: string;
	actor: TrailActor;
	/** The raw action, or a `record.*` key for a step read from a table rather than the audit log. */
	action: string;
	/** Plain-language step. */
	label: string;
	/** One line of context. Never contains an IP address or device. */
	detail: string;
	amountCentavos: number | null;
	source: 'audit' | 'record';
	/** Which order this belongs to; only shown when the trail spans several orders. */
	code: string | null;
	/** Hotel admins only: stripped for everyone else. */
	ip: string | null;
	userAgent: string | null;
	before: unknown;
	after: unknown;
}

export interface TrailOrder {
	id: string;
	code: string;
	status: string;
	paymentStatus: string;
	orderType: string;
	venue: string;
	tableLabel: string | null;
	guestName: string | null;
	source: string;
	totalCentavos: number;
	paymentMethod: string | null;
	createdAt: string;
	lines: { name: string; quantity: number }[];
}

export interface TrailReservation {
	id: string;
	code: string;
	status: string;
	guestName: string;
	partySize: number;
	startsAt: string;
	venue: string;
	source: string;
	tables: string[];
}

export interface TrailDocument {
	id: string;
	type: string;
	formattedNo: string;
	status: string;
	issuedAt: string;
	issuedBy: string | null;
	cancelledAt: string | null;
	cancelledBy: string | null;
	cancelReason: string | null;
	orderCode: string | null;
}

export interface DiningTrail {
	ref: string;
	kind: 'order' | 'reservation';
	/** Whether IP, device and before/after data are included (hotel admins only). */
	detailed: boolean;
	orders: TrailOrder[];
	reservation: TrailReservation | null;
	documents: TrailDocument[];
	handled: { role: string; who: string; at: string | null }[];
	money: {
		billedCentavos: number;
		collectedCentavos: number;
		byMethod: { method: string; centavos: number }[];
		roomChargedCentavos: number;
		refundedCentavos: number;
		netCentavos: number;
		receiptNos: string[];
		invoiceNos: string[];
	};
	events: TrailEvent[];
}

// ---------------------------------------------------------------------------
// Resolving the code
// ---------------------------------------------------------------------------

/** `DN-ABCD` / `TB-ABCD`, or a bare four-character code. */
export function normaliseTrailRef(raw: string): string[] {
	const q = raw.trim().toUpperCase();
	if (/^DN-[A-Z0-9]{4}$/.test(q) || /^TB-[A-Z0-9]{4}$/.test(q)) return [q];
	if (/^[A-Z0-9]{4}$/.test(q)) return [`DN-${q}`, `TB-${q}`];
	return [];
}

/** The DN-/TB- number of a dining order or reservation id, or null (also when it is another hotel's). */
export async function codeForId(hotelId: string, id: string): Promise<string | null> {
	const [o] = await db.select({ code: diningOrders.code }).from(diningOrders).where(and(eq(diningOrders.id, id), eq(diningOrders.hotelId, hotelId))).limit(1);
	if (o) return o.code;
	const [r] = await db.select({ code: diningReservations.code }).from(diningReservations).where(and(eq(diningReservations.id, id), eq(diningReservations.hotelId, hotelId))).limit(1);
	return r?.code ?? null;
}

type OrderRow = typeof diningOrders.$inferSelect;
type ReservationRow = typeof diningReservations.$inferSelect;

async function resolve(hotelId: string, raw: string) {
	for (const code of normaliseTrailRef(raw)) {
		if (code.startsWith('DN-')) {
			const [o] = await db
				.select()
				.from(diningOrders)
				.where(and(eq(diningOrders.hotelId, hotelId), eq(diningOrders.code, code)))
				.limit(1);
			if (o) return { ref: code, kind: 'order' as const, order: o, reservation: null };
		} else {
			const [r] = await db
				.select()
				.from(diningReservations)
				.where(and(eq(diningReservations.hotelId, hotelId), eq(diningReservations.code, code)))
				.limit(1);
			if (r) return { ref: code, kind: 'reservation' as const, order: null, reservation: r };
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Reading an audit row
// ---------------------------------------------------------------------------

type AuditRow = typeof auditLog.$inferSelect;
/** The record-derived keys an audit entry already accounts for. */
function coversOf(a: AuditRow): string[] {
	const after = obj(a.after);
	const orderId = str(after.orderId) ?? (a.entityType === 'dining_order' ? a.entityId : null);
	const keys: string[] = [];
	const k = (key: string, id: string | null | undefined) => id && keys.push(`${key}:${id}`);
	switch (a.action) {
		case 'dining_order.create':
			k('order.created', orderId);
			break;
		case 'dining_order.accept':
			k('order.accepted', orderId);
			break;
		case 'dining_order.status': {
			const to = str(after.status);
			if (to === 'accepted' || to === 'preparing') k('order.accepted', orderId);
			if (to === 'ready') k('order.ready', orderId);
			if (to === 'served') k('order.served', orderId);
			break;
		}
		case 'dining_order.station':
			if (str(after.status) === 'ready') k('order.ready', orderId);
			if (str(after.status) && str(after.status) !== 'new') k('order.accepted', orderId);
			break;
		case 'dining_order.force_served':
			k('order.served', orderId);
			break;
		case 'dining_order.dispatch':
			k('order.dispatched', orderId);
			break;
		case 'dining_order.cancel':
		case 'dining_order.decline':
		case 'dining_order.expired':
		case 'dining_order.guest_cancel':
		case 'dining_order.cancel_approved':
		case 'dining_order.pre_order_cancelled':
			k('order.cancelled', orderId);
			break;
		case 'dining_order.cancel_requested':
			k('order.cancel_requested', orderId);
			break;
		case 'dining_order.paid':
		case 'dining_order.paymongo_paid':
		case 'dining_order.room_charge':
			k('order.paid', orderId);
			k('cash', str(after.cashMovementId));
			k('pay.paid', str(after.paymentId));
			break;
		case 'dining_order.payment_failed':
			k('pay.failed', str(after.paymentId));
			break;
		case 'dining_order.checkout_started':
			k('pay.started', str(after.paymentId));
			break;
		case 'dining_order.checkout_expired':
			k('pay.expired', str(after.paymentId));
			break;
		case 'dining_order.refund':
			k('pay.refund', str(after.refundId));
			k('cash', str(after.cashMovementId));
			break;
		case 'bir.issue_official_receipt':
		case 'bir.issue_invoice':
			k('doc.issued', str(after.documentId));
			break;
		case 'bir.cancel_document':
			k('doc.cancelled', a.entityId);
			break;
		case 'finance.void_cash_movement':
			k('cash.voided', a.entityId);
			break;
		case 'dining_reservation.create':
			k('res.created', str(after.reservationId) ?? a.entityId);
			break;
		case 'dining_reservation.status':
			if (str(after.status) === 'cancelled') k('res.cancelled', str(after.reservationId) ?? a.entityId);
			break;
		case 'dining_check.bill_requested':
			k('check.billed', a.entityId);
			break;
		case 'dining_check.close':
		case 'dining_check.force_clear':
		case 'dining_check.merge':
			k('check.closed', a.entityId);
			break;
		default:
			break;
	}
	return keys;
}

/** Steps that happen in order inside one request share a timestamp; this orders them sensibly. */
const RANK: Record<string, number> = {
	'dining_reservation.create': 1,
	'dining_order.create': 2,
	'dining_order.checkout_expired': 3,
	'dining_order.checkout_started': 4,
	'dining_order.accept': 6,
	'dining_order.status': 7,
	'dining_order.station': 7,
	'dining_order.paid': 8,
	'dining_order.paymongo_paid': 8,
	'bir.issue_official_receipt': 9,
	'bir.issue_invoice': 9,
	'dining_check.settle': 10,
	'dining_check.close': 11
};

// ---------------------------------------------------------------------------
// Building the trail
// ---------------------------------------------------------------------------

export async function buildDiningTrail(
	hotelId: string,
	rawRef: string,
	opts: { admin: boolean }
): Promise<DiningTrail | null> {
	const found = await resolve(hotelId, rawRef);
	if (!found) return null;

	// ---- the related set -----------------------------------------------------------------
	let reservation: ReservationRow | null = found.reservation;
	let orderRows: OrderRow[] = [];
	if (found.kind === 'order') {
		orderRows = [found.order];
		if (found.order.reservationId) {
			const [r] = await db
				.select()
				.from(diningReservations)
				.where(and(eq(diningReservations.id, found.order.reservationId), eq(diningReservations.hotelId, hotelId)))
				.limit(1);
			reservation = r ?? null;
		}
	} else {
		orderRows = await db
			.select()
			.from(diningOrders)
			.where(and(eq(diningOrders.hotelId, hotelId), eq(diningOrders.reservationId, found.reservation.id)))
			.orderBy(asc(diningOrders.createdAt));
	}
	const orderIds = orderRows.map((o) => o.id);
	const codeById = new Map(orderRows.map((o) => [o.id, o.code]));

	const checkIds = [
		...new Set([
			...orderRows.map((o) => o.checkId).filter((x): x is string => !!x)
		])
	];
	const checkMatch = or(
		checkIds.length ? inArray(diningTableChecks.id, checkIds) : undefined,
		reservation && found.kind === 'reservation' ? eq(diningTableChecks.reservationId, reservation.id) : undefined
	);
	// Without a match the `where` would be the hotel alone, i.e. every check in the hotel.
	const checks = checkMatch
		? await db
				.select()
				.from(diningTableChecks)
				.where(and(eq(diningTableChecks.hotelId, hotelId), checkMatch))
		: [];
	const allCheckIds = checks.map((c) => c.id);

	const [items, payments, messages, docs] = orderIds.length
		? await Promise.all([
				db.select().from(diningOrderItems).where(inArray(diningOrderItems.orderId, orderIds)).orderBy(asc(diningOrderItems.sortOrder)),
				db.select().from(diningPayments).where(and(eq(diningPayments.hotelId, hotelId), inArray(diningPayments.orderId, orderIds))).orderBy(asc(diningPayments.createdAt)),
				db.select().from(diningOrderMessages).where(and(eq(diningOrderMessages.hotelId, hotelId), inArray(diningOrderMessages.orderId, orderIds))).orderBy(asc(diningOrderMessages.createdAt)),
				db.select().from(documents).where(and(eq(documents.hotelId, hotelId), inArray(documents.diningOrderId, orderIds))).orderBy(asc(documents.issuedAt))
			])
		: [[], [], [], []];
	const paymentIds = payments.map((p) => p.id);

	const movementIds = new Set(orderRows.map((o) => o.cashMovementId).filter((x): x is string => !!x));
	for (const p of payments) if (p.cashMovementId) movementIds.add(p.cashMovementId);
	const movements = orderIds.length
		? await db
				.select()
				.from(cashMovements)
				.where(
					and(
						eq(cashMovements.hotelId, hotelId),
						or(
							and(eq(cashMovements.sourceType, 'dining_order'), inArray(cashMovements.sourceId, orderIds)),
							paymentIds.length
								? and(inArray(cashMovements.sourceType, ['dining_payment', 'dining_refund']), inArray(cashMovements.sourceId, paymentIds))
								: undefined,
							movementIds.size ? inArray(cashMovements.id, [...movementIds]) : undefined
						)
					)
				)
				.orderBy(asc(cashMovements.occurredAt))
		: [];

	// ---- audit entries ---------------------------------------------------------------------
	const codes = [...orderRows.map((o) => o.code), ...(reservation ? [reservation.code] : [])];
	const entityMatches = [
		orderIds.length ? and(eq(auditLog.entityType, 'dining_order'), inArray(auditLog.entityId, orderIds)) : undefined,
		reservation ? and(eq(auditLog.entityType, 'dining_reservation'), eq(auditLog.entityId, reservation.id)) : undefined,
		allCheckIds.length ? and(eq(auditLog.entityType, 'dining_table_check'), inArray(auditLog.entityId, allCheckIds)) : undefined,
		docs.length ? and(eq(auditLog.entityType, 'document'), inArray(auditLog.entityId, docs.map((d) => d.id))) : undefined,
		movements.length ? and(eq(auditLog.entityType, 'cash_movement'), inArray(auditLog.entityId, movements.map((m) => m.id))) : undefined,
		codes.length ? inArray(auditLog.refCode, codes) : undefined
	];
	const auditRows = await db
		.select()
		.from(auditLog)
		.where(and(eq(auditLog.hotelId, hotelId), or(...entityMatches)))
		.orderBy(asc(auditLog.createdAt))
		.limit(1500);

	// ---- names for every user id a record mentions ----------------------------------------
	const userIds = new Set<string>();
	const addUser = (id: string | null | undefined) => id && userIds.add(id);
	for (const o of orderRows) {
		addUser(o.createdByUserId);
		addUser(o.paidByUserId);
	}
	for (const i of items) {
		addUser(i.startedByUserId);
		addUser(i.readyByUserId);
	}
	for (const p of payments) addUser(p.createdByUserId);
	for (const m of messages) addUser(m.authorUserId);
	for (const m of movements) {
		addUser(m.recordedByUserId);
		addUser(m.voidedByUserId);
	}
	for (const d of docs) {
		addUser(d.issuedByUserId);
		addUser(d.cancelledByUserId);
	}
	for (const c of checks) addUser(c.closedByUserId);
	addUser(reservation?.createdByUserId);
	const nameById = new Map<string, string>();
	if (userIds.size) {
		const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds]));
		for (const r of rows) nameById.set(r.id, r.name);
	}
	const staff = (id: string | null | undefined): TrailActor | null =>
		id ? { kind: 'staff', label: nameById.get(id) ?? 'Staff' } : null;
	const NOT_RECORDED: TrailActor = { kind: 'unknown', label: 'Not recorded' };

	// ---- events from the audit log ---------------------------------------------------------
	const events: (TrailEvent & { rank: number; covers: string[]; orderId: string | null })[] = [];
	const detailed = opts.admin;
	for (const a of auditRows) {
		const before = obj(a.before);
		const after = obj(a.after);
		const { detail, amount } = detailOf(a.action, before, after);
		const orderId = str(after.orderId) ?? (a.entityType === 'dining_order' ? a.entityId : null);
		events.push({
			at: a.createdAt.toISOString(),
			actor: actorOf(a),
			action: a.action,
			label: actionLabel(a.action),
			detail,
			amountCentavos: amount,
			source: 'audit',
			code: a.refCode ?? (orderId ? (codeById.get(orderId) ?? null) : null),
			ip: detailed ? a.ipAddress : null,
			userAgent: detailed ? a.userAgent : null,
			before: detailed ? a.before : null,
			after: detailed ? a.after : null,
			rank: RANK[a.action] ?? 50,
			covers: coversOf(a),
			orderId
		});
	}
	const covered = new Set(events.flatMap((e) => e.covers));
	const auditByOrder = (orderId: string) => events.filter((e) => e.source === 'audit' && e.orderId === orderId);

	// ---- events from the records (what the audit log did not capture) ---------------------
	const record = (
		key: string,
		at: Date | null | undefined,
		actor: TrailActor | null,
		label: string,
		detail: string,
		o: { orderId?: string | null; amount?: number | null; rank?: number } = {}
	) => {
		if (!at || covered.has(key)) return;
		events.push({
			at: at.toISOString(),
			actor: actor ?? NOT_RECORDED,
			action: `record.${key.split(':')[0]}`,
			label,
			detail,
			amountCentavos: o.amount ?? null,
			source: 'record',
			code: o.orderId ? (codeById.get(o.orderId) ?? null) : null,
			ip: null,
			userAgent: null,
			before: null,
			after: null,
			rank: o.rank ?? 50,
			covers: [],
			orderId: o.orderId ?? null
		});
	};

	if (reservation) {
		const online = reservation.source === 'online';
		record(
			`res.created:${reservation.id}`,
			reservation.createdAt,
			staff(reservation.createdByUserId) ?? (online ? { kind: 'guest', label: 'Guest' } : NOT_RECORDED),
			'Table reserved',
			[reservation.guestName, `party of ${reservation.partySize}`, online ? 'booked online' : 'booked by staff'].join(' · '),
			{ rank: 1 }
		);
		record(`res.cancelled:${reservation.id}`, reservation.cancelledAt, null, 'Reservation cancelled', '');
	}

	for (const o of orderRows) {
		const viaGuest = o.source === 'online' || o.source === 'qr';
		record(
			`order.created:${o.id}`,
			o.createdAt,
			staff(o.createdByUserId) ?? (viaGuest ? { kind: 'guest', label: o.source === 'qr' ? 'Guest (table QR)' : 'Guest (online)' } : NOT_RECORDED),
			'Order placed',
			[words(o.orderType), o.tableLabel ? `table ${o.tableLabel}` : null, o.guestName].filter(Boolean).join(' · '),
			{ orderId: o.id, amount: o.totalCentavos, rank: 2 }
		);
		record(`order.accepted:${o.id}`, o.acceptedAt, null, 'Order accepted', '', { orderId: o.id, rank: 6 });
		record(`order.dispatched:${o.id}`, o.outForDeliveryAt, null, 'Delivery sent out with a rider', o.riderName ? `rider ${o.riderName}` : '', { orderId: o.id });
		record(`order.ready:${o.id}`, o.readyAt, null, 'Order ready', '', { orderId: o.id, rank: 7 });
		record(`order.served:${o.id}`, o.servedAt, null, 'Order served', '', { orderId: o.id, rank: 7 });
		record(`order.cancel_requested:${o.id}`, o.cancelRequestedAt, { kind: 'guest', label: 'Guest' }, 'Guest asked to cancel a paid order', o.cancelRequestNote ?? '', { orderId: o.id });
		record(`order.cancelled:${o.id}`, o.cancelledAt, null, 'Order cancelled', o.cancelReason ?? '', { orderId: o.id });
		if (o.paymentStatus === 'room_charged') {
			record(`order.paid:${o.id}`, o.updatedAt, null, 'Charged to a room bill', o.roomLabel ? `room ${o.roomLabel}` : '', { orderId: o.id, amount: o.totalCentavos, rank: 8 });
		} else {
			record(
				`order.paid:${o.id}`,
				o.paidAt,
				staff(o.paidByUserId) ?? (o.paymentMethod === 'paymongo' ? { kind: 'system', label: 'System' } : null),
				'Payment received',
				[method(o.paymentMethod) ? `by ${method(o.paymentMethod)}` : null, o.tenderedCentavos != null ? `tendered ${peso(o.tenderedCentavos)}` : null, o.changeCentavos > 0 ? `change ${peso(o.changeCentavos)}` : null]
					.filter(Boolean)
					.join(' · '),
				{ orderId: o.id, amount: o.totalCentavos, rank: 8 }
			);
		}
	}

	// Kitchen: one step per moment a station was started or finished. An audit entry for the same
	// moment is enriched with the dish names rather than shown a second time.
	const lineName = (i: (typeof items)[number]) => `${i.quantity}× ${i.name}`;
	for (const o of orderRows) {
		for (const kind of ['started', 'ready'] as const) {
			const groups = new Map<string, typeof items>();
			for (const i of items.filter((x) => x.orderId === o.id)) {
				const at = kind === 'started' ? i.startedAt : i.readyAt;
				if (!at) continue;
				const by = (kind === 'started' ? i.startedByUserId : i.readyByUserId) ?? '';
				const key = `${Math.floor(at.getTime() / 1000)}|${by}`;
				groups.set(key, [...(groups.get(key) ?? []), i]);
			}
			for (const group of groups.values()) {
				const at = (kind === 'started' ? group[0]!.startedAt : group[0]!.readyAt)!;
				const names = group.map(lineName).join(', ');
				const target = kind === 'started' ? 'preparing' : 'ready';
				const match = auditByOrder(o.id).find((e) => {
					if (Math.abs(new Date(e.at).getTime() - at.getTime()) > 5000) return false;
					if (e.action === 'dining_order.station') return obj(e.after).to === target;
					if (e.action === 'dining_order.status') return obj(e.after).status === target;
					return false;
				});
				if (match) {
					match.detail = [match.detail, names].filter(Boolean).join(' · ');
					continue;
				}
				const who = staff(kind === 'started' ? group[0]!.startedByUserId : group[0]!.readyByUserId);
				record(`item.${kind}:${o.id}:${at.getTime()}`, at, who, kind === 'started' ? 'Kitchen started cooking' : 'Kitchen finished cooking', names, { orderId: o.id, rank: 7 });
			}
		}
	}

	for (const p of payments) {
		const orderId = p.orderId;
		const common = { orderId, amount: p.amountCentavos };
		if (p.kind === 'refund') {
			record(`pay.refund:${p.id}`, p.paidAt ?? p.createdAt, staff(p.createdByUserId), 'Refund recorded', [method(p.method) ? `via ${method(p.method)}` : null, p.referenceNo ? `ref ${p.referenceNo}` : null, p.note].filter(Boolean).join(' · '), common);
			continue;
		}
		if (p.status === 'failed') {
			record(`pay.failed:${p.id}`, p.createdAt, { kind: 'system', label: 'System' }, 'Online payment attempt failed', '', common);
			continue;
		}
		record(`pay.started:${p.id}`, p.createdAt, null, 'Online checkout link created', '', common);
		if (p.status === 'paid') {
			record(`pay.paid:${p.id}`, p.paidAt ?? p.createdAt, { kind: 'system', label: 'System' }, 'Online payment confirmed (PayMongo)', '', { ...common, rank: 8 });
		}
	}

	const sameSecond = (a: string, b: Date) => Math.abs(new Date(a).getTime() - b.getTime()) <= 3000;
	const MESSAGE_MAKERS: Record<string, string> = {
		'dining_order.message': '',
		'dining_order.cancel_requested': 'guest',
		'dining_order.cancel_approved': 'staff',
		'dining_order.cancel_declined': 'staff',
		'dining_order.refund': 'staff'
	};
	for (const m of messages) {
		const duplicate = auditByOrder(m.orderId).some(
			(e) =>
				e.action in MESSAGE_MAKERS &&
				sameSecond(e.at, m.createdAt) &&
				(e.action === 'dining_order.message' ? obj(e.after).direction === m.direction : MESSAGE_MAKERS[e.action] === m.direction)
		);
		if (duplicate) continue;
		record(
			`msg:${m.id}`,
			m.createdAt,
			m.direction === 'guest' ? { kind: 'guest', label: 'Guest' } : (staff(m.authorUserId) ?? NOT_RECORDED),
			'Message sent',
			`${m.direction}: ${m.body.slice(0, 200)}`,
			{ orderId: m.orderId }
		);
	}

	for (const m of movements) {
		const label = m.direction === 'in' ? 'Cash in' : 'Cash out';
		record(`cash:${m.id}`, m.occurredAt, staff(m.recordedByUserId), `${label} posted to the ledger`, [words(m.category), m.memo].filter(Boolean).join(' · '), { amount: m.amountCentavos, rank: 8 });
		record(`cash.voided:${m.id}`, m.voidedAt, staff(m.voidedByUserId), 'Cash movement voided', m.voidReason ?? '', { amount: m.amountCentavos });
	}

	const docOrderCode = (d: (typeof docs)[number]) => (d.diningOrderId ? (codeById.get(d.diningOrderId) ?? null) : null);
	for (const d of docs) {
		const kind = d.type === 'invoice' ? 'Invoice' : 'Official receipt';
		record(`doc.issued:${d.id}`, d.issuedAt, staff(d.issuedByUserId), `${kind} issued`, d.formattedNo, { orderId: d.diningOrderId, rank: 9 });
		record(`doc.cancelled:${d.id}`, d.cancelledAt, staff(d.cancelledByUserId), `${kind} cancelled`, [d.formattedNo, d.cancelReason].filter(Boolean).join(' · '), { orderId: d.diningOrderId });
	}

	for (const c of checks) {
		record(`check.opened:${c.id}`, c.openedAt, null, 'Table opened', '', { rank: 3 });
		record(`check.billed:${c.id}`, c.billRequestedAt, null, 'Bill requested', '');
		record(`check.closed:${c.id}`, c.closedAt, staff(c.closedByUserId), c.forceClearedAt ? 'Table cleared by a manager' : 'Table closed', '', { rank: 11 });
	}

	events.sort(
		(a, b) =>
			a.at.localeCompare(b.at) || a.rank - b.rank || (a.source === b.source ? 0 : a.source === 'audit' ? -1 : 1)
	);

	// ---- who handled it ----------------------------------------------------------------------
	const firstBy = (pred: (e: (typeof events)[number]) => boolean) => events.find(pred);
	const handled: DiningTrail['handled'] = [];
	const add = (role: string, e: (typeof events)[number] | undefined) => {
		if (e) handled.push({ role, who: e.actor.label, at: e.at });
	};
	add('Placed by', firstBy((e) => e.action === 'dining_order.create' || e.action === 'record.order.created' || e.action === 'dining_reservation.create' || e.action === 'record.res.created'));
	add('Accepted by', firstBy((e) => e.action === 'dining_order.accept' || e.action === 'record.order.accepted'));
	const cooks = [
		...new Set(
			events
				.filter((e) => ['dining_order.station', 'dining_order.status', 'record.item'].includes(e.action) && e.actor.kind === 'staff')
				.map((e) => e.actor.label)
		)
	];
	if (cooks.length) handled.push({ role: 'Kitchen', who: cooks.join(', '), at: null });
	add('Paid / charged by', firstBy((e) => ['dining_order.paid', 'dining_order.paymongo_paid', 'dining_order.room_charge', 'record.order.paid'].includes(e.action)));
	add('Refunded by', firstBy((e) => e.action === 'dining_order.refund' || e.action === 'record.pay.refund'));
	add('Receipt issued by', firstBy((e) => e.action === 'bir.issue_official_receipt' || e.action === 'bir.issue_invoice' || e.action === 'record.doc.issued'));
	add(
		'Cancelled by',
		firstBy(
			(e) =>
				['dining_order.cancel', 'dining_order.decline', 'dining_order.guest_cancel', 'dining_order.expired', 'dining_order.cancel_approved'].includes(e.action) ||
				(e.action === 'dining_reservation.status' && /cancelled/.test(e.detail))
		)
	);

	// ---- money -----------------------------------------------------------------------------
	const live = orderRows.filter((o) => o.status !== 'cancelled' || o.paymentStatus === 'paid' || o.paymentStatus === 'refunded');
	const collected = orderRows.filter((o) => o.paymentStatus === 'paid' || o.paymentStatus === 'refunded');
	const byMethod = new Map<string, number>();
	for (const o of collected) byMethod.set(o.paymentMethod ?? 'unknown', (byMethod.get(o.paymentMethod ?? 'unknown') ?? 0) + o.totalCentavos);
	const refunded = payments.filter((p) => p.kind === 'refund' && p.status === 'paid').reduce((s, p) => s + p.amountCentavos, 0);
	const collectedCentavos = collected.reduce((s, o) => s + o.totalCentavos, 0);
	const liveDocs = docs.filter((d) => d.status === 'issued');

	// ---- the lists --------------------------------------------------------------------------
	const venueIds = [...new Set([...orderRows.map((o) => o.diningItemId), ...(reservation ? [reservation.diningItemId] : [])])];
	const venues = venueIds.length ? await db.select({ id: diningItems.id, title: diningItems.title }).from(diningItems).where(inArray(diningItems.id, venueIds)) : [];
	const venueTitle = (id: string) => venues.find((v) => v.id === id)?.title ?? '';
	const tables = reservation
		? await db
				.select({ name: diningTables.name })
				.from(diningReservationTables)
				.innerJoin(diningTables, eq(diningTables.id, diningReservationTables.tableId))
				.where(eq(diningReservationTables.reservationId, reservation.id))
				.orderBy(asc(diningTables.name))
		: [];

	return {
		ref: found.ref,
		kind: found.kind,
		detailed,
		orders: orderRows.map((o) => ({
			id: o.id,
			code: o.code,
			status: o.status,
			paymentStatus: o.paymentStatus,
			orderType: o.orderType,
			venue: venueTitle(o.diningItemId),
			tableLabel: o.tableLabel,
			guestName: o.guestName,
			source: o.source,
			totalCentavos: o.totalCentavos,
			paymentMethod: o.paymentMethod,
			createdAt: o.createdAt.toISOString(),
			lines: items.filter((i) => i.orderId === o.id).map((i) => ({ name: i.name, quantity: i.quantity }))
		})),
		reservation: reservation
			? {
					id: reservation.id,
					code: reservation.code,
					status: reservation.status,
					guestName: reservation.guestName,
					partySize: reservation.partySize,
					startsAt: reservation.startsAt.toISOString(),
					venue: venueTitle(reservation.diningItemId),
					source: reservation.source,
					tables: tables.map((t) => t.name)
				}
			: null,
		documents: docs.map((d) => ({
			id: d.id,
			type: d.type,
			formattedNo: d.formattedNo,
			status: d.status,
			issuedAt: d.issuedAt.toISOString(),
			issuedBy: d.issuedByUserId ? (nameById.get(d.issuedByUserId) ?? null) : null,
			cancelledAt: d.cancelledAt?.toISOString() ?? null,
			cancelledBy: d.cancelledByUserId ? (nameById.get(d.cancelledByUserId) ?? null) : null,
			cancelReason: d.cancelReason,
			orderCode: docOrderCode(d)
		})),
		handled,
		money: {
			billedCentavos: live.reduce((s, o) => s + o.totalCentavos, 0),
			collectedCentavos,
			byMethod: [...byMethod.entries()].map(([m, c]) => ({ method: m, centavos: c })),
			roomChargedCentavos: orderRows.filter((o) => o.paymentStatus === 'room_charged').reduce((s, o) => s + o.totalCentavos, 0),
			refundedCentavos: refunded,
			netCentavos: collectedCentavos - refunded,
			receiptNos: liveDocs.filter((d) => d.type === 'official_receipt').map((d) => d.formattedNo),
			invoiceNos: liveDocs.filter((d) => d.type === 'invoice').map((d) => d.formattedNo)
		},
		events: events.map(({ rank: _r, covers: _c, orderId: _o, ...e }) => e)
	};
}
