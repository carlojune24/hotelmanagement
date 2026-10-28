import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index';
import {
	diningOrders,
	diningPayments,
	guests,
	orders,
	payments,
	paymongoLedger,
	paymongoSyncState
} from '../db/schema/index';

/**
 * Reads of the mirror of PayMongo's own records (`paymongo_ledger`, filled by `paymongo-sync.ts`): the balance
 * cards, the incoming / outgoing list with its totals, and the "does PayMongo agree with our books" counts for
 * the Finance → PayMongo tab. Money is integer centavos throughout.
 */

const l = paymongoLedger;

/** A refund counts as money out unless it failed. */
const REFUND_COUNTED = ['succeeded', 'pending', 'processing', 'refunding'];
/** A payout counts as money on its way (or arrived) unless it came back or was cancelled. */
const PAYOUT_ON_THE_WAY = ['pending', 'in_transit', 'on_hold'];

export interface PaymongoBalance {
	/** Paid, past PayMongo's hold, not yet credited to the bank: what the next payout will carry (after refunds). */
	availableCentavos: number;
	/** Paid, but still inside PayMongo's hold: not available yet. */
	pendingCentavos: number;
	/** Refunds issued since the last payout, already taken off `availableCentavos`. */
	refundsSincePayoutCentavos: number;
	/** Payouts created but not yet in the bank. */
	onTheWayCentavos: number;
	/** Payouts that reached the bank in the last 30 days. */
	paidOut30dCentavos: number;
	/** The earliest scheduled credit date among payments still waiting for one. */
	nextCreditAt: Date | null;
	/** PayMongo's own wallet balance, only when the account has a wallet and it returned one. */
	wallet: { id: string; availableCentavos: number | null; pendingCentavos: number | null } | null;
	lastSyncedAt: Date | null;
	lastError: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

/** Finds a wallet's balances whatever the nesting (`attributes.available_balance`, `balance.available`, …). */
function readWallet(json: unknown): PaymongoBalance['wallet'] {
	if (!json || typeof json !== 'object') return null;
	const w = json as Record<string, unknown>;
	const id = typeof w.id === 'string' ? w.id : null;
	if (!id) return null;
	const sources = [w, w.attributes, (w.attributes as Record<string, unknown> | undefined)?.balance, w.balance].filter(
		(s): s is Record<string, unknown> => !!s && typeof s === 'object'
	);
	let available: number | null = null;
	let pending: number | null = null;
	for (const s of sources) {
		available ??= num(s.available_balance) ?? num(s.available) ?? (typeof s.balance === 'number' ? num(s.balance) : null);
		pending ??= num(s.pending_balance) ?? num(s.pending);
	}
	if (available === null && pending === null) return null;
	return { id, availableCentavos: available, pendingCentavos: pending };
}

export async function getPaymongoSyncState(hotelId: string) {
	const [row] = await db.select().from(paymongoSyncState).where(eq(paymongoSyncState.hotelId, hotelId)).limit(1);
	return row ?? null;
}

/**
 * Where the money is right now, from PayMongo's own records. PayMongo publishes no merchant-balance endpoint, so
 * this is an estimate built the way its dashboard builds it: a payment is **pending** until its `available_at`,
 * then **available** until its scheduled credit (`credited_at`) or a payout takes it. If the account has a
 * PayMongo wallet, that wallet's own balance is returned as well and is the number to trust.
 */
export async function getPaymongoBalance(hotelId: string): Promise<PaymongoBalance> {
	const [state, agg] = await Promise.all([
		getPaymongoSyncState(hotelId),
		db
			.select({
				pending: sql<number>`coalesce(sum(${l.netCentavos}) filter (where ${l.kind} = 'payment' and ${l.status} = 'paid' and ${l.availableAt} > now()), 0)::int`,
				available: sql<number>`coalesce(sum(${l.netCentavos}) filter (where ${l.kind} = 'payment' and ${l.status} = 'paid' and (${l.availableAt} is null or ${l.availableAt} <= now()) and ${l.payoutId} is null and (${l.creditedAt} is null or ${l.creditedAt} > now())), 0)::int`,
				refunds: sql<number>`coalesce(sum(${l.grossCentavos}) filter (where ${l.kind} = 'refund' and ${l.status} in (${sql.join(REFUND_COUNTED.map((s) => sql`${s}`), sql`, `)}) and ${l.occurredAt} > coalesce((select max(p.occurred_at) from paymongo_ledger p where p.hotel_id = ${hotelId} and p.kind = 'payout'), 'epoch'::timestamptz)), 0)::int`,
				onTheWay: sql<number>`coalesce(sum(${l.netCentavos}) filter (where ${l.kind} = 'payout' and ${l.status} in (${sql.join(PAYOUT_ON_THE_WAY.map((s) => sql`${s}`), sql`, `)})), 0)::int`,
				paidOut: sql<number>`coalesce(sum(${l.netCentavos}) filter (where ${l.kind} = 'payout' and ${l.status} = 'deposited' and ${l.occurredAt} > now() - interval '30 days'), 0)::int`,
				nextCredit: sql<Date | null>`min(${l.creditedAt}) filter (where ${l.kind} = 'payment' and ${l.status} = 'paid' and ${l.payoutId} is null and ${l.creditedAt} > now())`
			})
			.from(l)
			.where(eq(l.hotelId, hotelId))
	]);
	const a = agg[0];
	return {
		availableCentavos: Math.max(0, (a?.available ?? 0) - (a?.refunds ?? 0)),
		pendingCentavos: a?.pending ?? 0,
		refundsSincePayoutCentavos: a?.refunds ?? 0,
		onTheWayCentavos: a?.onTheWay ?? 0,
		paidOut30dCentavos: a?.paidOut ?? 0,
		nextCreditAt: a?.nextCredit ? new Date(a.nextCredit) : null,
		wallet: state?.walletSupported ? readWallet(state.walletBalance) : null,
		lastSyncedAt: state?.lastSyncedAt ?? null,
		lastError: state?.lastError ?? null
	};
}

export type LedgerDirection = 'all' | 'in' | 'out';
export type LedgerKind = 'all' | 'payment' | 'refund' | 'payout';

export interface LedgerFilter {
	direction: LedgerDirection;
	kind: LedgerKind;
	/** PayMongo's own status, or `all`. */
	status: string;
	/** Dates in the hotel's timezone (YYYY-MM-DD). */
	from?: string;
	to?: string;
	q?: string;
	/** `unlinked` = payments PayMongo has that no booking or dining order in our system claims. */
	recon?: 'unlinked';
}

export interface LedgerRow {
	id: string;
	paymongoId: string;
	kind: string;
	direction: string;
	status: string;
	grossCentavos: number;
	feeCentavos: number;
	netCentavos: number;
	currency: string;
	occurredAt: Date;
	availableAt: Date | null;
	creditedAt: Date | null;
	payoutId: string | null;
	balanceTransactionId: string | null;
	sourceType: string | null;
	reference: string | null;
	description: string | null;
	paymentId: string | null;
	orderId: string | null;
	diningOrderId: string | null;
	diningCode: string | null;
	guestName: string | null;
	bankName: string | null;
	accountLast4: string | null;
	raw: unknown;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The page's and the CSV's filters from a URL, every value checked (anything odd falls back to "all"). */
export function parseLedgerFilter(url: URL): LedgerFilter {
	const p = url.searchParams;
	const dir = p.get('dir');
	const kind = p.get('kind');
	const status = p.get('status') ?? 'all';
	const from = p.get('from') ?? '';
	const to = p.get('to') ?? '';
	return {
		direction: dir === 'in' || dir === 'out' ? dir : 'all',
		kind: kind === 'payment' || kind === 'refund' || kind === 'payout' ? kind : 'all',
		status: /^[a-z_]{1,30}$/.test(status) ? status : 'all',
		from: ISO.test(from) ? from : undefined,
		to: ISO.test(to) ? to : undefined,
		q: (p.get('q') ?? '').slice(0, 80) || undefined,
		recon: p.get('recon') === 'unlinked' ? 'unlinked' : undefined
	};
}

function whereFor(hotelId: string, tz: string, f: LedgerFilter): SQL | undefined {
	const conds: (SQL | undefined)[] = [eq(l.hotelId, hotelId)];
	if (f.direction !== 'all') conds.push(eq(l.direction, f.direction));
	if (f.kind !== 'all') conds.push(eq(l.kind, f.kind));
	if (f.status !== 'all') conds.push(eq(l.status, f.status));
	if (f.from) conds.push(sql`(${l.occurredAt} at time zone ${tz})::date >= ${f.from}::date`);
	if (f.to) conds.push(sql`(${l.occurredAt} at time zone ${tz})::date <= ${f.to}::date`);
	if (f.recon === 'unlinked') {
		conds.push(sql`${l.kind} = 'payment' and ${l.status} = 'paid' and ${l.orderId} is null and ${l.diningOrderId} is null`);
	}
	const q = f.q?.trim();
	if (q) {
		const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
		conds.push(
			or(
				ilike(l.paymongoId, like),
				ilike(l.reference, like),
				ilike(l.payoutId, like),
				ilike(l.paymentId, like),
				ilike(l.description, like),
				ilike(guests.fullName, like),
				ilike(diningOrders.code, like),
				ilike(diningOrders.guestName, like)
			)
		);
	}
	return and(...conds);
}

/** The filtered rows, newest first, plus totals over the WHOLE filtered set (not just the rows shown). */
export async function listPaymongoLedger(hotelId: string, tz: string, f: LedgerFilter, limit = 300) {
	const where = whereFor(hotelId, tz, f);
	const base = db
		.select({
			id: l.id,
			paymongoId: l.paymongoId,
			kind: l.kind,
			direction: l.direction,
			status: l.status,
			grossCentavos: l.grossCentavos,
			feeCentavos: l.feeCentavos,
			netCentavos: l.netCentavos,
			currency: l.currency,
			occurredAt: l.occurredAt,
			availableAt: l.availableAt,
			creditedAt: l.creditedAt,
			payoutId: l.payoutId,
			balanceTransactionId: l.balanceTransactionId,
			sourceType: l.sourceType,
			reference: l.reference,
			description: l.description,
			paymentId: l.paymentId,
			orderId: l.orderId,
			diningOrderId: l.diningOrderId,
			diningCode: diningOrders.code,
			guestName: sql<string | null>`coalesce(${guests.fullName}, ${diningOrders.guestName})`,
			bankName: l.bankName,
			accountLast4: l.accountLast4,
			raw: l.raw
		})
		.from(l)
		.leftJoin(orders, eq(orders.id, l.orderId))
		.leftJoin(guests, eq(guests.id, orders.guestId))
		.leftJoin(diningOrders, eq(diningOrders.id, l.diningOrderId));

	const [rows, totals] = await Promise.all([
		base.where(where).orderBy(desc(l.occurredAt)).limit(limit),
		db
			.select({
				count: sql<number>`count(*)::int`,
				inGross: sql<number>`coalesce(sum(${l.grossCentavos}) filter (where ${l.kind} = 'payment' and ${l.status} = 'paid'), 0)::int`,
				inFees: sql<number>`coalesce(sum(${l.feeCentavos}) filter (where ${l.kind} = 'payment' and ${l.status} = 'paid'), 0)::int`,
				inNet: sql<number>`coalesce(sum(${l.netCentavos}) filter (where ${l.kind} = 'payment' and ${l.status} = 'paid'), 0)::int`,
				refundsOut: sql<number>`coalesce(sum(${l.grossCentavos}) filter (where ${l.kind} = 'refund' and ${l.status} in (${sql.join(REFUND_COUNTED.map((s) => sql`${s}`), sql`, `)})), 0)::int`,
				payoutsOut: sql<number>`coalesce(sum(${l.netCentavos}) filter (where ${l.kind} = 'payout' and ${l.status} not in ('returned', 'cancelled', 'failed', 'unknown')), 0)::int`
			})
			.from(l)
			.leftJoin(orders, eq(orders.id, l.orderId))
			.leftJoin(guests, eq(guests.id, orders.guestId))
			.leftJoin(diningOrders, eq(diningOrders.id, l.diningOrderId))
			.where(where)
	]);
	return { rows: rows as LedgerRow[], totals: totals[0]!, truncated: (totals[0]?.count ?? 0) > rows.length };
}

/** Distinct statuses present, for the status filter. */
export async function listLedgerStatuses(hotelId: string): Promise<string[]> {
	const rows = await db.selectDistinct({ s: l.status }).from(l).where(eq(l.hotelId, hotelId));
	return rows.map((r) => r.s).sort();
}

export interface Reconciliation {
	/** PayMongo payments (paid) that no booking or dining order in our system claims, e.g. taken on the dashboard. */
	unlinkedPayments: number;
	/** Online payments our app recorded as paid that PayMongo's list does not contain (yet). */
	missingInPaymongo: { count: number; items: { paymongoId: string; amountCentavos: number; orderId: string; where: 'booking' | 'dining' }[] };
	/** False until the first full sync, when "missing" would only mean "not pulled yet". */
	ready: boolean;
}

export async function getReconciliation(hotelId: string): Promise<Reconciliation> {
	const state = await getPaymongoSyncState(hotelId);
	const ready = !!state?.backfilledAt;
	const [{ n: unlinked } = { n: 0 }] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(l)
		.where(
			and(
				eq(l.hotelId, hotelId),
				eq(l.kind, 'payment'),
				eq(l.status, 'paid'),
				sql`${l.orderId} is null and ${l.diningOrderId} is null`
			)
		);
	if (!ready) return { unlinkedPayments: unlinked, missingInPaymongo: { count: 0, items: [] }, ready };

	const notInLedger = (col: SQL) =>
		sql`not exists (select 1 from paymongo_ledger pl where pl.hotel_id = ${hotelId} and pl.paymongo_id = ${col})`;
	const [room, dining] = await Promise.all([
		db
			.select({ paymongoId: payments.paymongoPaymentId, amount: payments.amountCentavos, orderId: payments.orderId })
			.from(payments)
			.innerJoin(orders, eq(orders.id, payments.orderId))
			.where(
				and(
					eq(orders.hotelId, hotelId),
					eq(payments.provider, 'paymongo'),
					eq(payments.status, 'paid'),
					sql`${payments.purpose} <> 'refund' and ${payments.paymongoPaymentId} is not null`,
					notInLedger(sql`${payments.paymongoPaymentId}`)
				)
			)
			.limit(20),
		db
			.select({ paymongoId: diningPayments.paymongoPaymentId, amount: diningPayments.amountCentavos, orderId: diningPayments.orderId })
			.from(diningPayments)
			.where(
				and(
					eq(diningPayments.hotelId, hotelId),
					eq(diningPayments.provider, 'paymongo'),
					eq(diningPayments.status, 'paid'),
					eq(diningPayments.kind, 'payment'),
					sql`${diningPayments.paymongoPaymentId} is not null`,
					notInLedger(sql`${diningPayments.paymongoPaymentId}`)
				)
			)
			.limit(20)
	]);
	const items = [
		...room.map((r) => ({ paymongoId: r.paymongoId!, amountCentavos: r.amount, orderId: r.orderId, where: 'booking' as const })),
		...dining.map((r) => ({ paymongoId: r.paymongoId!, amountCentavos: Number(r.amount), orderId: r.orderId, where: 'dining' as const }))
	];
	return { unlinkedPayments: unlinked, missingInPaymongo: { count: items.length, items }, ready };
}
