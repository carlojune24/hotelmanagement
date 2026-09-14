/**
 * @mm/finance-core/reports — pure contracts for the consolidated report builders.
 * No DB code lives here: each app implements these against its own schema, and a
 * future cross-app consolidator (or a hotel group) calls the same shapes over
 * `hotelIds: string[]` so one hotel, a group, or an external consumer all get the
 * same report.
 */
import { z } from 'zod';
import { plainDate } from '@mm/integration';
import { accountType, accountSubtype } from './coa';

export const reportParams = z.object({
	hotelIds: z.array(z.string().uuid()).min(1),
	dateFrom: plainDate,
	dateTo: plainDate,
	dimensions: z
		.object({
			department: z.string().optional(),
			costCenter: z.string().optional(),
			project: z.string().optional()
		})
		.optional()
});
export type ReportParams = z.infer<typeof reportParams>;

export const trialBalanceRow = z.object({
	accountId: z.string().uuid(),
	code: z.string(),
	name: z.string(),
	type: accountType,
	debitMinor: z.number().int(),
	creditMinor: z.number().int()
});
export type TrialBalanceRow = z.infer<typeof trialBalanceRow>;

/** One row per account subtype; `byHotel` carries a total per requested `hotelIds`
 *  entry, `total` is the sum across all of them. */
export const incomeStatementRow = z.object({
	subtype: accountSubtype,
	label: z.string(),
	byHotel: z.record(z.string().uuid(), z.number().int()),
	total: z.number().int()
});
export type IncomeStatementRow = z.infer<typeof incomeStatementRow>;

export const balanceSheetRow = z.object({
	accountId: z.string().uuid(),
	code: z.string(),
	name: z.string(),
	type: accountType,
	subtype: accountSubtype,
	balanceMinor: z.number().int()
});
export type BalanceSheetRow = z.infer<typeof balanceSheetRow>;

export const ledgerRow = z.object({
	journalEntryId: z.string().uuid(),
	entryNo: z.string(),
	date: plainDate,
	memo: z.string().nullable(),
	sourceType: z.string(),
	sourceId: z.string().uuid().nullable(),
	debitMinor: z.number().int(),
	creditMinor: z.number().int(),
	runningBalanceMinor: z.number().int()
});
export type LedgerRow = z.infer<typeof ledgerRow>;
