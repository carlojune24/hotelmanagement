import { PayMongoError } from '@mm/paymongo';
import type { PayMongoPaymentRecord, PayMongoPayout, PayMongoWallet, Refund } from '@mm/paymongo';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index';
import {
	diningOrders,
	diningPayments,
	orders,
	payments,
	paymongoLedger,
	paymongoSettings,
	paymongoSyncState
} from '../db/schema/index';
import { getPaymongoClient, PaymentsNotConfiguredError } from '../paymongo/client';

/**
 * Mirrors the hotel's PayMongo money (payments in with fee and net, refunds, payouts to the bank, and a wallet if
 * the account has one) into `paymongo_ledger`, straight from PayMongo's own list APIs, so staff can see what is
 * really in PayMongo without logging in to its dashboard. Read-only against PayMongo, and display-only here: it
 * never posts a cash movement (finance stays cash-basis).
 *
 * The first run pulls the whole history (capped); afterwards only a recent window is re-read, because a payment
 * keeps changing after it is paid (`available_at`, `credited_at`, the payout it joins).
 */

const PAGE = 100;
/** The most rows pulled per kind on the first run. */
const BACKFILL_CAP = 5000;
/** Later runs re-read this many days back. */
const WINDOW_DAYS = 45;
const PAGE_DELAY_MS = 150;

const ms = (secs: number | null | undefined) => (secs != null ? new Date(secs * 1000) : null);
const int = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0);
const sleep = (t: number) => new Promise((r) => setTimeout(r, t));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LedgerInsert = typeof paymongoLedger.$inferInsert;

/** What PayMongo calls a payout on a payment is an id, or a small object holding it. */
function payoutIdOf(v: unknown): string | null {
	if (typeof v === 'string') return v;
	if (v && typeof v === 'object' && 'id' in v && typeof (v as { id: unknown }).id === 'string') {
		return (v as { id: string }).id;
	}
	return null;
}

/** The customer's billing block (name, email, phone, address) is personal data the Finance tab has no use for. */
function withoutBilling<T extends Record<string, unknown>>(attributes: T): Omit<T, 'billing'> {
	const { billing: _drop, ...rest } = attributes;
	return rest;
}

function mapPayment(p: PayMongoPaymentRecord, hotelId: string): LedgerInsert {
	const a = p.attributes;
	return {
		hotelId,
		paymongoId: p.id,
		kind: 'payment',
		direction: 'in',
		status: a.status,
		grossCentavos: int(a.amount),
		feeCentavos: int(a.fee),
		netCentavos: int(a.net_amount),
		currency: a.currency ?? 'PHP',
		occurredAt: ms(a.paid_at) ?? ms(a.created_at) ?? new Date(),
		availableAt: ms(a.available_at),
		creditedAt: ms(a.credited_at),
		payoutId: payoutIdOf(a.payout),
		balanceTransactionId: a.balance_transaction_id ?? null,
		sourceType: a.source?.type ?? null,
		reference: a.external_reference_number ?? a.metadata?.pm_reference_number ?? null,
		description: a.description ?? null,
		raw: { id: p.id, type: p.type, attributes: withoutBilling(a) }
	};
}

function mapRefund(r: Refund, hotelId: string): LedgerInsert {
	const a = r.attributes;
	const created = typeof a.created_at === 'number' ? a.created_at : null;
	return {
		hotelId,
		paymongoId: r.id,
		kind: 'refund',
		direction: 'out',
		status: a.status,
		grossCentavos: int(a.amount),
		feeCentavos: 0,
		netCentavos: int(a.amount),
		currency: a.currency ?? 'PHP',
		occurredAt: ms(created) ?? new Date(),
		paymentId: a.payment_id ?? null,
		reference: null,
		description: a.notes ?? (a.reason ? String(a.reason).replace(/_/g, ' ') : null),
		raw: { id: r.id, type: r.type, attributes: withoutBilling(a) }
	};
}

function mapPayout(po: PayMongoPayout, hotelId: string): LedgerInsert {
	const digits = (po.bank_account_number ?? '').replace(/\D/g, '');
	const last4 = digits ? digits.slice(-4) : null;
	// Keep PayMongo's record, but never the full bank account number or the account holder's name.
	const { bank_account_number: _n, bank_account_name: _h, ...safe } = po;
	return {
		hotelId,
		paymongoId: po.id,
		kind: 'payout',
		direction: 'out',
		status: po.status,
		grossCentavos: int(po.amount),
		feeCentavos: int(po.fee),
		netCentavos: int(po.net_amount),
		currency: po.currency ?? 'PHP',
		occurredAt: ms(po.created_at) ?? new Date(),
		reference: po.last_payout_transfer?.reference_number ?? null,
		description: po.description ?? null,
		bankName: po.bank_name ?? null,
		accountLast4: last4,
		raw: { ...safe, bank_account_last4: last4 }
	};
}

/** Which booking / dining order each PayMongo payment belongs to, from our own records. */
async function linkOrders(hotelId: string, rows: LedgerInsert[]): Promise<void> {
	const paymentIds = new Set<string>();
	for (const r of rows) {
		if (r.kind === 'payment') paymentIds.add(r.paymongoId);
		if (r.kind === 'refund' && r.paymentId) paymentIds.add(r.paymentId);
	}
	const ids = [...paymentIds];
	const byRoom = new Map<string, string>();
	const byDining = new Map<string, string>();
	for (let i = 0; i < ids.length; i += 500) {
		const chunk = ids.slice(i, i + 500);
		const room = await db
			.select({ pid: payments.paymongoPaymentId, orderId: payments.orderId })
			.from(payments)
			.innerJoin(orders, eq(orders.id, payments.orderId))
			.where(and(eq(orders.hotelId, hotelId), inArray(payments.paymongoPaymentId, chunk)));
		for (const r of room) if (r.pid) byRoom.set(r.pid, r.orderId);
		const dining = await db
			.select({ pid: diningPayments.paymongoPaymentId, orderId: diningPayments.orderId })
			.from(diningPayments)
			.where(and(eq(diningPayments.hotelId, hotelId), inArray(diningPayments.paymongoPaymentId, chunk)));
		for (const r of dining) if (r.pid) byDining.set(r.pid, r.orderId);
	}

	// A payment our webhook has not recorded (yet) may still say whose it is in the metadata we put on checkout.
	const metaOrder = new Map<string, string>();
	const metaDining = new Map<string, string>();
	for (const r of rows) {
		if (r.kind !== 'payment' || byRoom.has(r.paymongoId) || byDining.has(r.paymongoId)) continue;
		const meta = (r.raw as { attributes?: { metadata?: Record<string, string> | null } } | null)?.attributes?.metadata;
		if (meta?.orderId && UUID.test(meta.orderId)) metaOrder.set(r.paymongoId, meta.orderId);
		if (meta?.diningOrderId && UUID.test(meta.diningOrderId)) metaDining.set(r.paymongoId, meta.diningOrderId);
	}
	const validOrders = new Set<string>();
	const validDining = new Set<string>();
	const wantOrders = [...new Set(metaOrder.values())];
	const wantDining = [...new Set(metaDining.values())];
	if (wantOrders.length) {
		for (const o of await db
			.select({ id: orders.id })
			.from(orders)
			.where(and(eq(orders.hotelId, hotelId), inArray(orders.id, wantOrders)))) validOrders.add(o.id);
	}
	if (wantDining.length) {
		for (const o of await db
			.select({ id: diningOrders.id })
			.from(diningOrders)
			.where(and(eq(diningOrders.hotelId, hotelId), inArray(diningOrders.id, wantDining)))) validDining.add(o.id);
	}

	for (const r of rows) {
		const key = r.kind === 'refund' ? r.paymentId : r.paymongoId;
		if (!key) continue;
		const o = byRoom.get(key) ?? (metaOrder.has(key) && validOrders.has(metaOrder.get(key)!) ? metaOrder.get(key) : undefined);
		const d = byDining.get(key) ?? (metaDining.has(key) && validDining.has(metaDining.get(key)!) ? metaDining.get(key) : undefined);
		if (o) r.orderId = o;
		if (d) r.diningOrderId = d;
	}
}

async function upsert(hotelId: string, rows: LedgerInsert[]): Promise<void> {
	if (rows.length === 0) return;
	await linkOrders(hotelId, rows);
	for (let i = 0; i < rows.length; i += 200) {
		await db
			.insert(paymongoLedger)
			.values(rows.slice(i, i + 200))
			.onConflictDoUpdate({
				target: [paymongoLedger.hotelId, paymongoLedger.paymongoId],
				set: {
					status: sql`excluded.status`,
					grossCentavos: sql`excluded.gross_centavos`,
					feeCentavos: sql`excluded.fee_centavos`,
					netCentavos: sql`excluded.net_centavos`,
					occurredAt: sql`excluded.occurred_at`,
					availableAt: sql`excluded.available_at`,
					creditedAt: sql`excluded.credited_at`,
					payoutId: sql`excluded.payout_id`,
					balanceTransactionId: sql`excluded.balance_transaction_id`,
					sourceType: sql`excluded.source_type`,
					reference: sql`excluded.reference`,
					description: sql`excluded.description`,
					paymentId: sql`excluded.payment_id`,
					// A link found earlier is never lost to a later run that could not find it.
					orderId: sql`coalesce(excluded.order_id, paymongo_ledger.order_id)`,
					diningOrderId: sql`coalesce(excluded.dining_order_id, paymongo_ledger.dining_order_id)`,
					bankName: sql`excluded.bank_name`,
					accountLast4: sql`excluded.account_last4`,
					raw: sql`excluded.raw`,
					syncedAt: sql`now()`
				}
			});
	}
}

/** What went wrong, in words a front-desk person can act on. */
function friendlyError(e: unknown): string {
	if (e instanceof PaymentsNotConfiguredError) return 'PayMongo is not connected for this hotel.';
	if (e instanceof PayMongoError) {
		if (e.status === 401) return 'PayMongo rejected the saved secret key. Reconnect it in Settings → Payments & email.';
		if (e.status === 403) return 'This PayMongo key is not allowed to read that. Check its permissions in PayMongo.';
		if (e.status === 429) return 'PayMongo is rate limiting requests. It will retry on the next sync.';
		return `PayMongo returned an error (HTTP ${e.status}).`;
	}
	return e instanceof Error ? e.message : 'Could not reach PayMongo.';
}

/**
 * Throws out anything mirrored under the other mode. PayMongo stamps every payment and refund with `livemode`, so
 * a live key's mirror must never keep a test record (and the other way round) — money that was never real would
 * otherwise sit in the totals forever, since the sync only ever upserts. Rows PayMongo sends with no flag (payouts)
 * are left alone.
 */
async function dropWrongModeRows(hotelId: string): Promise<void> {
	const [settings] = await db
		.select({ mode: paymongoSettings.mode })
		.from(paymongoSettings)
		.where(eq(paymongoSettings.hotelId, hotelId))
		.limit(1);
	if (!settings) return;
	const live = settings.mode === 'live';
	await db
		.delete(paymongoLedger)
		.where(
			and(
				eq(paymongoLedger.hotelId, hotelId),
				sql`(${paymongoLedger.raw} -> 'attributes' ->> 'livemode') is not null`,
				sql`((${paymongoLedger.raw} -> 'attributes' ->> 'livemode')::boolean) is distinct from ${live}`
			)
		);
}

const running = new Map<string, Promise<SyncResult>>();

export interface SyncResult {
	ok: boolean;
	error: string | null;
	payments: number;
	refunds: number;
	payouts: number;
}

/**
 * Pulls PayMongo's records for one hotel into the mirror. One run per hotel at a time (a second caller gets the
 * run already in flight). Never throws: the outcome, including a rejected key, is recorded on the sync state.
 */
export function syncPaymongo(hotelId: string): Promise<SyncResult> {
	const existing = running.get(hotelId);
	if (existing) return existing;
	const run = doSync(hotelId).finally(() => running.delete(hotelId));
	running.set(hotelId, run);
	return run;
}

/** True while a sync for this hotel is running in this process (the page polls until it is done). */
export function isPaymongoSyncing(hotelId: string): boolean {
	return running.has(hotelId);
}

async function doSync(hotelId: string): Promise<SyncResult> {
	const result: SyncResult = { ok: false, error: null, payments: 0, refunds: 0, payouts: 0 };
	try {
		const client = await getPaymongoClient(hotelId);
		await dropWrongModeRows(hotelId);
		const [state] = await db.select().from(paymongoSyncState).where(eq(paymongoSyncState.hotelId, hotelId)).limit(1);
		const backfill = !state?.backfilledAt;
		const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
		// Stops once a page reaches records older than the window (a later run) or the cap (the first run).
		const tooOld = (createdSecs: number | null | undefined) => !backfill && createdSecs != null && createdSecs * 1000 < cutoff;

		// Payments: newest first, the cursor is the id of the last record.
		let after: string | undefined;
		for (let n = 0; n < BACKFILL_CAP; ) {
			const page = await client.listPayments({ limit: PAGE, after });
			if (page.data.length === 0) break;
			await upsert(hotelId, page.data.map((p) => mapPayment(p, hotelId)));
			n += page.data.length;
			result.payments += page.data.length;
			const last = page.data.at(-1)!;
			if (!page.hasMore || tooOld(last.attributes.created_at)) break;
			after = last.id;
			await sleep(PAGE_DELAY_MS);
		}

		// Refunds.
		after = undefined;
		for (let n = 0; n < BACKFILL_CAP; ) {
			const page = await client.listRefunds({ limit: PAGE, after });
			if (page.data.length === 0) break;
			await upsert(hotelId, page.data.map((r) => mapRefund(r, hotelId)));
			n += page.data.length;
			result.refunds += page.data.length;
			const last = page.data.at(-1)!;
			const created = typeof last.attributes.created_at === 'number' ? last.attributes.created_at : null;
			if (!page.hasMore || tooOld(created)) break;
			after = last.id;
			await sleep(PAGE_DELAY_MS);
		}

		// Payouts: the cursor comes back in the response.
		let cursor: string | undefined;
		for (let n = 0; n < BACKFILL_CAP; ) {
			const page = await client.listPayouts({ limit: PAGE, after: cursor });
			if (page.data.length === 0) break;
			await upsert(hotelId, page.data.map((po) => mapPayout(po, hotelId)));
			n += page.data.length;
			result.payouts += page.data.length;
			if (!page.nextCursor || tooOld(page.data.at(-1)!.created_at)) break;
			cursor = page.nextCursor;
			await sleep(PAGE_DELAY_MS);
		}

		// A wallet exists only on accounts with PayMongo's Money Movement product: then its own balance is the truth.
		let wallet: PayMongoWallet | null = null;
		try {
			const wallets = await client.listWallets();
			if (wallets[0]) wallet = await client.retrieveWallet(wallets[0].id).catch(() => wallets[0]!);
		} catch {
			// Not enabled for this key: the computed balance is used instead.
		}

		const now = new Date();
		await db
			.insert(paymongoSyncState)
			.values({
				hotelId,
				lastSyncedAt: now,
				backfilledAt: now,
				lastError: null,
				walletSupported: wallet !== null,
				walletBalance: wallet
			})
			.onConflictDoUpdate({
				target: paymongoSyncState.hotelId,
				set: {
					lastSyncedAt: now,
					backfilledAt: state?.backfilledAt ?? now,
					lastError: null,
					walletSupported: wallet !== null,
					walletBalance: wallet,
					updatedAt: now
				}
			});
		result.ok = true;
	} catch (e) {
		result.error = friendlyError(e);
		await db
			.insert(paymongoSyncState)
			.values({ hotelId, lastError: result.error })
			.onConflictDoUpdate({
				target: paymongoSyncState.hotelId,
				set: { lastError: result.error, updatedAt: new Date() }
			})
			.catch(() => undefined);
		if (!(e instanceof PaymentsNotConfiguredError)) console.error('[paymongo-sync]', hotelId, result.error);
	}
	return result;
}

/** Refreshes only when the mirror is older than `maxAgeMs` (or never filled). Returns whether a sync ran. */
export async function syncPaymongoIfStale(hotelId: string, maxAgeMs: number): Promise<boolean> {
	const [state] = await db.select().from(paymongoSyncState).where(eq(paymongoSyncState.hotelId, hotelId)).limit(1);
	if (state?.lastSyncedAt && Date.now() - state.lastSyncedAt.getTime() < maxAgeMs) return false;
	await syncPaymongo(hotelId);
	return true;
}

/**
 * Drops the whole mirror for a hotel. The ledger holds whatever account the saved key pointed at, so when that key
 * is replaced by one for a different account or mode (test → live), the old rows are another account's money and
 * must go; the next sync refills from the new key.
 */
export async function clearPaymongoMirror(hotelId: string): Promise<void> {
	await db.delete(paymongoLedger).where(eq(paymongoLedger.hotelId, hotelId));
	await db.delete(paymongoSyncState).where(eq(paymongoSyncState.hotelId, hotelId));
}

/** Every hotel with PayMongo connected, for the background job. */
export async function listPaymongoHotelIds(): Promise<string[]> {
	return (await db.select({ id: paymongoSettings.hotelId }).from(paymongoSettings)).map((r) => r.id);
}
