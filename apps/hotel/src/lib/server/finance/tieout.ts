import { sql } from 'drizzle-orm';
import type { db as Db } from '../db/index';
import { explainTieOut } from './calc';

// Takes the database as a parameter (type-only import) like `seed-defaults.ts`, so the same
// code runs inside the app, inside a rolled-back test transaction, and from the CLI check
// (`scripts/check-ledger-tieout.ts`) without dragging in the app's `$env` import.
type DbLike = Pick<typeof Db, 'execute'>;

export interface CashTieOutRow {
	/** Every cash account this row covers — more than one when accounts share a ledger account. */
	cashAccountIds: string[];
	/** Account name(s), joined with " + " when several share a ledger account. */
	name: string;
	kind: string;
	openingCentavos: number;
	storedCentavos: number;
	ledgerCentavos: number;
	movementNetCentavos: number;
	unpostedNetCentavos: number;
	/** stored − ledger. Zero means the two agree. */
	differenceCentavos: number;
	/** Plain-English causes; empty when the row ties out. */
	reasons: string[];
	ok: boolean;
}

/**
 * Does the stored running balance of each cash account (`cash_accounts.current_balance_centavos`,
 * which every report reads) agree with what the double-entry ledger says? They are two independent
 * records of the same money — a movement updates both in one transaction — so any gap means one of
 * them is wrong, and `explainTieOut` names which way.
 *
 * Compared **per ledger account**, not per cash account: every cash account of a kind posts to one
 * shared ledger account (all banks to 1020 — `coa-seed.ts`), so a hotel with two bank accounts has
 * one ledger balance for both, and only their sum can be checked against it.
 *
 * Read-only. Cheap enough to run on every load of a finance page or from a script.
 */
export async function cashLedgerTieOut(dbc: DbLike, hotelId: string): Promise<CashTieOutRow[]> {
	const rows = await dbc.execute(sql`
		with mv as (
			select
				m.cash_account_id,
				sum(case when m.direction = 'in' then m.amount_centavos else -m.amount_centavos end) as net,
				sum(case when m.journal_entry_id is null
					then (case when m.direction = 'in' then m.amount_centavos else -m.amount_centavos end)
					else 0 end) as unposted
			from cash_movements m
			where m.hotel_id = ${hotelId} and m.voided_at is null
			group by m.cash_account_id
		),
		led as (
			select l.account_id, sum(l.debit_centavos) - sum(l.credit_centavos) as bal
			from journal_lines l
			where l.hotel_id = ${hotelId}
			group by l.account_id
		),
		grp as (
			select
				coalesce(a.coa_account_id::text, a.id::text) as k,
				max(a.coa_account_id::text) as coa,
				string_agg(a.id::text, ',' order by a.name, a.id) as ids,
				string_agg(a.name, ' + ' order by a.name, a.id) as name,
				min(a.kind::text) as kind,
				sum(a.opening_balance_centavos) as opening,
				sum(a.current_balance_centavos) as stored,
				bool_and(a.coa_account_id is null) as no_coa,
				coalesce(sum(mv.net), 0) as movement_net,
				coalesce(sum(mv.unposted), 0) as unposted_net
			from cash_accounts a
			left join mv on mv.cash_account_id = a.id
			where a.hotel_id = ${hotelId}
			group by 1
		)
		select
			grp.ids, grp.name, grp.kind, grp.no_coa,
			grp.opening::text as opening,
			grp.stored::text as stored,
			grp.movement_net::text as movement_net,
			grp.unposted_net::text as unposted_net,
			coalesce(led.bal, 0)::text as ledger
		from grp
		left join led on led.account_id::text = grp.coa
		order by grp.name, grp.ids
	`);

	return (rows as unknown as Record<string, string | boolean>[]).map((r) => {
		const input = {
			openingCentavos: Number(r.opening),
			storedCentavos: Number(r.stored),
			ledgerCentavos: Number(r.ledger),
			movementNetCentavos: Number(r.movement_net),
			unpostedNetCentavos: Number(r.unposted_net),
			noCoaLink: r.no_coa === true
		};
		const reasons = explainTieOut(input);
		return {
			cashAccountIds: String(r.ids).split(','),
			name: String(r.name),
			kind: String(r.kind),
			openingCentavos: input.openingCentavos,
			storedCentavos: input.storedCentavos,
			ledgerCentavos: input.ledgerCentavos,
			movementNetCentavos: input.movementNetCentavos,
			unpostedNetCentavos: input.unpostedNetCentavos,
			differenceCentavos: input.storedCentavos - input.ledgerCentavos,
			reasons,
			ok: reasons.length === 0
		};
	});
}
