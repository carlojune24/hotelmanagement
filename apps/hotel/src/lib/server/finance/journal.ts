import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { chartOfAccounts, financeSettings, journalEntries, journalLines } from '../db/schema/index';
import type { SessionUser } from '../auth/session';
import { FinanceError, type Tx } from './shared';
import { assertBusinessDateOpen } from './cash';

export interface PostJournalEntryLine {
	accountId: string;
	debitCentavos: number;
	creditCentavos: number;
	department?: string | null;
	costCenter?: string | null;
	project?: string | null;
	counterpartyId?: string | null;
}

export interface PostJournalEntryInput {
	hotelId: string;
	entryDate: string;
	memo?: string | null;
	sourceType: 'cash_movement' | 'manual';
	sourceId?: string | null;
	reversalOfEntryId?: string | null;
	lines: PostJournalEntryLine[];
	actor?: SessionUser | null;
}

/**
 * THE single choke point for posting to the double-entry ledger — mirrors
 * `finance/cash.ts`'s `recordCashMovement`. Validates the entry balances, inserts
 * the immutable header + lines in one transaction, and bumps the hotel's gapless
 * `entry_no` counter under a row lock (same pattern as `finance/documents.ts`'s
 * `allocateSerial`). There is no edit/void — corrections are made only by posting a
 * second, reversing entry (swap every line's debit/credit, set `reversalOfEntryId`).
 *
 * Pass a `tx` to post atomically with the operation that caused it (in practice,
 * always called from inside `recordCashMovement`'s own transaction); omit it and
 * this opens its own.
 */
export async function postJournalEntry(input: PostJournalEntryInput, tx?: Tx): Promise<string> {
	if (input.lines.length < 2) {
		throw new FinanceError('A journal entry needs at least two lines.');
	}
	let debitTotal = 0;
	let creditTotal = 0;
	for (const line of input.lines) {
		const hasDebit = line.debitCentavos > 0;
		const hasCredit = line.creditCentavos > 0;
		if (hasDebit === hasCredit || !Number.isInteger(line.debitCentavos) || !Number.isInteger(line.creditCentavos)) {
			throw new FinanceError('Each journal line must have exactly one of a debit or a credit amount.');
		}
		debitTotal += line.debitCentavos;
		creditTotal += line.creditCentavos;
	}
	// Same rule as `@mm/finance-core`'s `assertBalanced` — kept as a direct sum here
	// since this app posts by internal `accountId`, not the cross-app `account_ref`
	// shape `assertBalanced`'s `JournalEntryDraft` expects.
	if (debitTotal !== creditTotal) {
		throw new FinanceError(`Journal entry does not balance: debits=${debitTotal} credits=${creditTotal}.`);
	}

	const run = async (t: Tx) => {
		await assertBusinessDateOpen(input.hotelId, input.entryDate, t);

		const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
		const accounts = await t
			.select({ id: chartOfAccounts.id, hotelId: chartOfAccounts.hotelId, isPostable: chartOfAccounts.isPostable })
			.from(chartOfAccounts)
			.where(inArray(chartOfAccounts.id, accountIds));
		for (const id of accountIds) {
			const acct = accounts.find((a) => a.id === id);
			if (!acct || acct.hotelId !== input.hotelId) {
				throw new FinanceError('One of the journal accounts was not found for this hotel.');
			}
			if (!acct.isPostable) {
				throw new FinanceError('One of the journal accounts is a roll-up account and cannot be posted to directly.');
			}
		}

		const [settings] = await t
			.select({ nextNo: financeSettings.nextJournalEntryNo })
			.from(financeSettings)
			.where(eq(financeSettings.hotelId, input.hotelId))
			.for('update')
			.limit(1);
		if (!settings) throw new FinanceError('Finance is not set up for this hotel yet.');
		const entryNo = `JE-${String(settings.nextNo).padStart(6, '0')}`;
		await t
			.update(financeSettings)
			.set({ nextJournalEntryNo: sql`${financeSettings.nextJournalEntryNo} + 1`, updatedAt: new Date() })
			.where(eq(financeSettings.hotelId, input.hotelId));

		const [entry] = await t
			.insert(journalEntries)
			.values({
				hotelId: input.hotelId,
				entryNo,
				entryDate: input.entryDate,
				memo: input.memo ?? null,
				sourceType: input.sourceType,
				sourceId: input.sourceId ?? null,
				reversalOfEntryId: input.reversalOfEntryId ?? null,
				postedByUserId: input.actor?.id ?? null
			})
			.returning({ id: journalEntries.id });

		await t.insert(journalLines).values(
			input.lines.map((l) => ({
				journalEntryId: entry!.id,
				accountId: l.accountId,
				debitCentavos: l.debitCentavos,
				creditCentavos: l.creditCentavos,
				hotelId: input.hotelId,
				department: l.department ?? null,
				costCenter: l.costCenter ?? null,
				project: l.project ?? null,
				counterpartyId: l.counterpartyId ?? null
			}))
		);

		return entry!.id;
	};

	return tx ? run(tx) : db.transaction(run);
}

/** Fetches a posted entry's lines, for building a reversal. */
export async function getJournalEntryLines(entryId: string, t: Tx) {
	return t.select().from(journalLines).where(and(eq(journalLines.journalEntryId, entryId)));
}
