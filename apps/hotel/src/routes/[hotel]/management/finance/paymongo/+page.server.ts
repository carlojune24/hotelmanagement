import { fail } from '@sveltejs/kit';
import { requireCap } from '$lib/server/auth/rbac';
import { getPaymongoConnection } from '$lib/server/paymongo/connection';
import {
	getPaymongoBalance,
	getReconciliation,
	listLedgerStatuses,
	listPaymongoLedger,
	parseLedgerFilter
} from '$lib/server/finance/paymongo-ledger';
import { isPaymongoSyncing, syncPaymongo, syncPaymongoIfStale } from '$lib/server/finance/paymongo-sync';
import type { Actions, PageServerLoad } from './$types';

/** How old the mirror may be before opening the tab refreshes it in the background. */
const STALE_MS = 2 * 60_000;
/** "Sync now" can be pressed again after this long. */
const MANUAL_GAP_MS = 30_000;
const lastManual = new Map<string, number>();

/**
 * Finance → PayMongo: the hotel's real PayMongo money, taken from PayMongo's own records (see
 * `finance/paymongo-sync.ts`) so staff need not sign in to the PayMongo dashboard. Opening the tab refreshes a stale
 * mirror in the background and never waits for it.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireCap(locals.user, locals.role, 'finance:read');
	const hotel = locals.hotel!;
	const connection = await getPaymongoConnection(hotel.id);
	const filter = parseLedgerFilter(url);
	if (!connection) {
		return { connected: false as const, filter };
	}

	void syncPaymongoIfStale(hotel.id, STALE_MS);

	const [balance, ledger, statuses, recon] = await Promise.all([
		getPaymongoBalance(hotel.id),
		listPaymongoLedger(hotel.id, hotel.timezone, filter),
		listLedgerStatuses(hotel.id),
		getReconciliation(hotel.id)
	]);

	return {
		connected: true as const,
		connection: { mode: connection.mode, keyHint: connection.secretKeyHint },
		timezone: hotel.timezone,
		filter,
		balance,
		rows: ledger.rows,
		totals: ledger.totals,
		truncated: ledger.truncated,
		statuses,
		recon,
		syncing: isPaymongoSyncing(hotel.id)
	};
};

export const actions: Actions = {
	/** "Sync now": starts a refresh and returns at once; the page polls until it finishes. */
	sync: async ({ locals }) => {
		requireCap(locals.user, locals.role, 'finance:read');
		const hotelId = locals.hotel!.id;
		if (isPaymongoSyncing(hotelId)) return { started: true };
		const last = lastManual.get(hotelId) ?? 0;
		if (Date.now() - last < MANUAL_GAP_MS) {
			return fail(429, { error: 'Just synced. Give it a few seconds before syncing again.' });
		}
		lastManual.set(hotelId, Date.now());
		void syncPaymongo(hotelId);
		return { started: true };
	}
};
