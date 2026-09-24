import { describe, expect, it } from 'vitest';
import {
	buildBalanceSheet,
	buildIncomeStatement,
	buildTrialBalance,
	naturalAmount,
	type AccountSums
} from './ledger-statements';

const acct = (code: string, type: AccountSums['type'], debit: number, credit: number, name = code): AccountSums => ({
	accountId: `id-${code}`,
	code,
	name,
	type,
	debit,
	credit
});

describe('naturalAmount — signed by type, not normal balance', () => {
	it('income is credit − debit; expense is debit − credit', () => {
		expect(naturalAmount({ type: 'income', debit: 100, credit: 900 })).toBe(800);
		expect(naturalAmount({ type: 'expense', debit: 900, credit: 100 })).toBe(800);
	});
	it('assets are debit − credit; liabilities and equity are credit − debit', () => {
		expect(naturalAmount({ type: 'asset', debit: 500, credit: 200 })).toBe(300);
		expect(naturalAmount({ type: 'liability', debit: 0, credit: 400 })).toBe(400);
		expect(naturalAmount({ type: 'equity', debit: 0, credit: 400 })).toBe(400);
	});
	it('a contra-revenue account (Refunds & Allowances: income, debit-normal) comes out NEGATIVE', () => {
		expect(naturalAmount({ type: 'income', debit: 30_100, credit: 0 })).toBe(-30_100);
	});
	it("a contra-equity account (Owner's Draw: equity, debit-normal) comes out negative", () => {
		expect(naturalAmount({ type: 'equity', debit: 50_000, credit: 0 })).toBe(-50_000);
	});
});

describe('buildIncomeStatement', () => {
	const accts = [
		acct('4010', 'income', 0, 1_000_000, 'Room Revenue'),
		acct('4090', 'income', 30_100, 0, 'Refunds & Allowances'),
		acct('5030', 'expense', 200_000, 0, 'Payroll'),
		acct('1010', 'asset', 5, 0, 'Cash') // ignored: not income/expense
	];

	it('nets refunds OUT of income and reports net income', () => {
		const s = buildIncomeStatement(accts);
		expect(s.totalIncome).toBe(1_000_000 - 30_100);
		expect(s.income.map((l) => l.code)).toEqual(['4010', '4090']);
		expect(s.income.find((l) => l.code === '4090')!.amountCentavos).toBe(-30_100);
		expect(s.totalExpenses).toBe(200_000);
		expect(s.netIncome).toBe(1_000_000 - 30_100 - 200_000);
	});

	it('drops zero lines but not the totals', () => {
		const s = buildIncomeStatement([acct('4010', 'income', 0, 0), acct('5030', 'expense', 0, 0)]);
		expect(s.income).toEqual([]);
		expect(s.netIncome).toBe(0);
	});

	it('shows a loss as a negative net income', () => {
		expect(buildIncomeStatement([acct('5030', 'expense', 90_000, 0), acct('4010', 'income', 0, 40_000)]).netIncome).toBe(-50_000);
	});
});

describe('buildBalanceSheet', () => {
	// ₱5,000 opening from the owner; ₱2,000 room revenue in cash; ₱300 refunded; ₱700 expense; ₱1,000 owner draw.
	const cash = 500_000 + 200_000 - 30_000 - 70_000 - 100_000; // 500,000
	const books = [
		acct('1010', 'asset', 500_000 + 200_000, 30_000 + 70_000 + 100_000, 'Cash'),
		acct('3010', 'equity', 0, 500_000, "Owner's Equity"),
		acct('3020', 'equity', 100_000, 0, "Owner's Draw"),
		acct('4010', 'income', 0, 200_000, 'Room Revenue'),
		acct('4090', 'income', 30_000, 0, 'Refunds & Allowances'),
		acct('5900', 'expense', 70_000, 0, 'Other Expense')
	];

	it('balances once earnings to date are included — and would not without them', () => {
		const bs = buildBalanceSheet(books);
		expect(bs.totalAssets).toBe(cash);
		expect(bs.earningsToDate).toBe(200_000 - 30_000 - 70_000); // 100,000
		expect(bs.balanced).toBe(true);
		expect(bs.difference).toBe(0);
		// the owner's draw reduces equity rather than adding to it
		expect(bs.equity.find((l) => l.code === '3020')!.amountCentavos).toBe(-100_000);
		// without the earnings line the sheet would be out by exactly the profit to date
		expect(bs.totalAssets - (bs.totalLiabilities + (bs.totalEquity - bs.earningsToDate))).toBe(bs.earningsToDate);
	});

	it('reports an imbalance instead of hiding it (an entry written around the choke point)', () => {
		const bs = buildBalanceSheet([...books, acct('1020', 'asset', 12_345, 0, 'Bank')]);
		expect(bs.balanced).toBe(false);
		expect(bs.difference).toBe(12_345);
	});

	it('an empty ledger balances at zero', () => {
		const bs = buildBalanceSheet([]);
		expect(bs.balanced).toBe(true);
		expect(bs.totalAssets).toBe(0);
	});
});

describe('buildTrialBalance', () => {
	const accts = [acct('1010', 'asset', 300, 100), acct('4010', 'income', 0, 200), acct('1020', 'asset', 0, 0), acct('5030', 'expense', 0, 0)];

	it('hides inactive accounts by default and shows them with showAll', () => {
		expect(buildTrialBalance(accts).lines.map((l) => l.code)).toEqual(['1010', '4010']);
		expect(buildTrialBalance(accts, { showAll: true }).lines).toHaveLength(4);
	});

	it('totals cover every account so a hidden row cannot hide an imbalance', () => {
		const tb = buildTrialBalance(accts);
		expect(tb.totalDebit).toBe(300);
		expect(tb.totalCredit).toBe(300);
		expect(tb.balanced).toBe(true);
		const off = buildTrialBalance([...accts, acct('1030', 'asset', 0, 0), acct('9999', 'asset', 40, 0)]);
		expect(off.balanced).toBe(false);
		expect(off.difference).toBe(40);
	});

	it('sorts by account code numerically', () => {
		const tb = buildTrialBalance([acct('1090', 'asset', 1, 0), acct('1010', 'asset', 1, 0), acct('1011', 'asset', 1, 0), acct('1020', 'asset', 0, 3)]);
		expect(tb.lines.map((l) => l.code)).toEqual(['1010', '1011', '1020', '1090']);
	});
});
