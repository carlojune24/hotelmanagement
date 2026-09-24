import { and, eq, isNull, like, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { cashAccounts, chartOfAccounts, hotels, journalEntries, type CashAccount } from '../db/schema/index';
import type { SessionUser } from '../auth/session';
import { FinanceError, type Tx } from './shared';
import { openingBalanceLines } from './calc';
import { CASH_ACCOUNT_KIND_TO_COA_CODE } from './coa-seed';
import { postJournalEntry } from './journal';

/** Owner's Equity — the credit side of an opening balance (`coa-seed.ts`). */
const OWNERS_EQUITY_CODE = '3010';
const MEMO_PREFIX = 'Opening balance';

async function coaIdByCode(hotelId: string, code: string, t: Tx): Promise<string> {
	const [row] = await t
		.select({ id: chartOfAccounts.id })
		.from(chartOfAccounts)
		.where(and(eq(chartOfAccounts.hotelId, hotelId), eq(chartOfAccounts.code, code)))
		.limit(1);
	if (!row) {
		throw new FinanceError(
			`This hotel's chart of accounts has no account ${code} yet. Run the chart-of-accounts backfill.`
		);
	}
	return row.id;
}

/** The hotel's ledger account a cash account of this kind posts to. Every kind maps to one
 *  shared account (all bank accounts to 1020, and so on) — `coa-seed.ts`. */
export async function coaAccountIdForKind(
	hotelId: string,
	kind: CashAccount['kind'],
	t: Tx
): Promise<string> {
	const code = CASH_ACCOUNT_KIND_TO_COA_CODE[kind];
	if (!code) throw new FinanceError(`No ledger account is defined for a "${kind}" cash account.`);
	return coaIdByCode(hotelId, code, t);
}

/**
 * Puts a cash account's opening balance on the books: Dr the account's ledger account, Cr
 * Owner's Equity. Without it the stored balance (opening + movements) is higher than the
 * ledger by exactly the opening, and every ledger report understates cash.
 *
 * Idempotent — returns `null` when the opening is zero or an opening entry already exists.
 * Uses the standard's `manual` source type (`docs/standards/finance.md`) with the cash account
 * as the source, since an opening balance is a hand-entered adjusting entry, not a cash movement.
 */
export async function postOpeningBalanceEntry(
	input: { hotelId: string; cashAccountId: string; entryDate: string; actor: SessionUser | null },
	tx: Tx
): Promise<string | null> {
	const [account] = await tx
		.select()
		.from(cashAccounts)
		.where(and(eq(cashAccounts.id, input.cashAccountId), eq(cashAccounts.hotelId, input.hotelId)))
		.limit(1);
	if (!account) throw new FinanceError('Cash account not found.');
	if (account.openingBalanceCentavos === 0) return null;
	if (!account.coaAccountId) {
		throw new FinanceError(`${account.name} has no chart-of-accounts link yet, so its opening balance can't be posted.`);
	}

	const [existing] = await tx
		.select({ id: journalEntries.id })
		.from(journalEntries)
		.where(
			and(
				eq(journalEntries.hotelId, input.hotelId),
				eq(journalEntries.sourceType, 'manual'),
				eq(journalEntries.sourceId, account.id),
				isNull(journalEntries.reversalOfEntryId),
				like(journalEntries.memo, `${MEMO_PREFIX}%`)
			)
		)
		.limit(1);
	if (existing) return null;

	const equityId = await coaIdByCode(input.hotelId, OWNERS_EQUITY_CODE, tx);
	return postJournalEntry(
		{
			hotelId: input.hotelId,
			entryDate: input.entryDate,
			memo: `${MEMO_PREFIX} — ${account.name}`,
			sourceType: 'manual',
			sourceId: account.id,
			actor: input.actor,
			lines: openingBalanceLines(account.coaAccountId, equityId, account.openingBalanceCentavos)
		},
		tx
	);
}

export interface OpeningBalanceRepair {
	account: string;
	outcome: 'posted' | 'already_posted_or_zero' | 'linked_and_posted' | 'failed';
	detail?: string;
}

/**
 * Repairs a hotel whose cash accounts pre-date this: links any account with no ledger account
 * (by kind) and posts every missing opening-balance entry, each dated to the day the account was
 * created (in the hotel's timezone) — which is when that money became part of its balance, and
 * matches the "opening balance" row the Cash page shows. Idempotent; a failure on one account
 * (e.g. its creation day is already closed) is reported and doesn't stop the others.
 */
export async function repairOpeningBalances(
	hotelId: string,
	actor: SessionUser | null
): Promise<OpeningBalanceRepair[]> {
	const [hotel] = await db.select({ timezone: hotels.timezone }).from(hotels).where(eq(hotels.id, hotelId)).limit(1);
	const tz = hotel?.timezone ?? 'Asia/Manila';
	const accounts = await db
		.select()
		.from(cashAccounts)
		.where(and(eq(cashAccounts.hotelId, hotelId), sql`${cashAccounts.deletedAt} is null`));

	const out: OpeningBalanceRepair[] = [];
	for (const a of accounts) {
		try {
			const result = await db.transaction(async (tx: Tx) => {
				let linked = false;
				if (!a.coaAccountId) {
					const coaId = await coaAccountIdForKind(hotelId, a.kind, tx);
					await tx.update(cashAccounts).set({ coaAccountId: coaId, updatedAt: new Date() }).where(eq(cashAccounts.id, a.id));
					linked = true;
				}
				const entryDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(a.createdAt);
				const id = await postOpeningBalanceEntry({ hotelId, cashAccountId: a.id, entryDate, actor }, tx);
				return { linked, id };
			});
			out.push({
				account: a.name,
				outcome: result.id ? (result.linked ? 'linked_and_posted' : 'posted') : 'already_posted_or_zero'
			});
		} catch (e) {
			out.push({ account: a.name, outcome: 'failed', detail: e instanceof Error ? e.message : String(e) });
		}
	}
	return out;
}
