import { describe, expect, it } from 'vitest';
import {
	advanceDueDate,
	cashOnOtherDays,
	changeFor,
	expectedShiftCash,
	explainTieOut,
	findUnresolvedDays,
	openingBalanceLines,
	unresolvedDayMessage,
	inputVatOf,
	isClosedOnBehalf,
	shiftAge,
	toCsv
} from './calc';

describe('shiftAge', () => {
	const opened = new Date('2026-09-23T13:00:00Z');
	it('is not stale under the threshold', () => {
		expect(shiftAge(opened, new Date('2026-09-24T04:59:00Z'), 16)).toEqual({
			hoursOpen: 15,
			stale: false
		});
	});
	it('goes stale exactly at the threshold', () => {
		expect(shiftAge(opened, new Date('2026-09-24T05:00:00Z'), 16)).toEqual({
			hoursOpen: 16,
			stale: true
		});
	});
	it('does not flag an overnight shift that crosses midnight', () => {
		// 11pm → 7am Manila = 8h, well inside 16h even though the date changed.
		expect(shiftAge(new Date('2026-09-23T15:00:00Z'), new Date('2026-09-23T23:00:00Z'), 16).stale).toBe(
			false
		);
	});
	it('never returns negative hours if the clock is behind', () => {
		expect(shiftAge(opened, new Date('2026-09-23T12:00:00Z'), 16).hoursOpen).toBe(0);
	});
});

describe('cashOnOtherDays', () => {
	const mv = (businessDate: string, direction: string, amountCentavos: number) => ({
		businessDate,
		direction,
		amountCentavos
	});
	it('is empty for a same-day shift', () => {
		expect(cashOnOtherDays([mv('2026-09-23', 'in', 50_000)], '2026-09-23')).toEqual([]);
	});
	it("groups an overnight shift's after-midnight cash under the later date, in and out separately", () => {
		expect(
			cashOnOtherDays(
				[
					mv('2026-09-23', 'in', 100_000),
					mv('2026-09-24', 'in', 30_000),
					mv('2026-09-24', 'in', 20_000),
					mv('2026-09-24', 'out', 5_000)
				],
				'2026-09-23'
			)
		).toEqual([{ businessDate: '2026-09-24', cashInCentavos: 50_000, cashOutCentavos: 5_000 }]);
	});
	it('orders multiple other dates oldest first', () => {
		const out = cashOnOtherDays([mv('2026-09-25', 'in', 1), mv('2026-09-24', 'in', 1)], '2026-09-23');
		expect(out.map((d) => d.businessDate)).toEqual(['2026-09-24', '2026-09-25']);
	});
});

describe('openingBalanceLines', () => {
	it('debits the cash account and credits equity for a positive opening', () => {
		expect(openingBalanceLines('cash', 'equity', 500_000)).toEqual([
			{ accountId: 'cash', debitCentavos: 500_000, creditCentavos: 0 },
			{ accountId: 'equity', debitCentavos: 0, creditCentavos: 500_000 }
		]);
	});
	it('reverses the sides for a negative (overdrawn) opening', () => {
		expect(openingBalanceLines('cash', 'equity', -20_000)).toEqual([
			{ accountId: 'cash', debitCentavos: 0, creditCentavos: 20_000 },
			{ accountId: 'equity', debitCentavos: 20_000, creditCentavos: 0 }
		]);
	});
	it('posts nothing for a zero opening', () => {
		expect(openingBalanceLines('cash', 'equity', 0)).toEqual([]);
	});
	it('always balances', () => {
		for (const n of [1, 999_999_999, -1, -123_456]) {
			const l = openingBalanceLines('c', 'e', n);
			expect(l.reduce((s, x) => s + x.debitCentavos, 0)).toBe(l.reduce((s, x) => s + x.creditCentavos, 0));
		}
	});
});

describe('explainTieOut', () => {
	// A healthy account: ₱5,000 opening posted to the ledger, ₱1,200 net of movements, all posted.
	const ok = {
		openingCentavos: 500_000,
		storedCentavos: 620_000,
		ledgerCentavos: 620_000,
		movementNetCentavos: 120_000,
		unpostedNetCentavos: 0,
		noCoaLink: false
	};

	it('says nothing when stored, movements and ledger all agree', () => {
		expect(explainTieOut(ok)).toEqual([]);
	});

	it('flags an opening balance that never reached the ledger, and only that', () => {
		const r = explainTieOut({ ...ok, ledgerCentavos: 120_000 });
		expect(r).toEqual(["The ₱5,000.00 opening balance isn't in the ledger yet."]);
	});

	it('flags movements that were never journaled', () => {
		const r = explainTieOut({ ...ok, ledgerCentavos: 620_000 - 30_000, unpostedNetCentavos: 30_000 });
		expect(r).toHaveLength(1);
		expect(r[0]).toContain('₱300.00 of movements have no journal entry');
	});

	it('flags a stored balance that drifted from its own movements (hand-edited rows)', () => {
		const r = explainTieOut({ ...ok, storedCentavos: 620_000 + 65_000 });
		expect(r).toHaveLength(1);
		expect(r[0]).toContain('₱650.00 above what its own movements add up to');
	});

	it('flags money still in the ledger that no live movement explains (a void never reversed)', () => {
		const r = explainTieOut({ ...ok, ledgerCentavos: 620_000 + 30_100 });
		expect(r).toHaveLength(1);
		expect(r[0]).toContain('₱301.00 extra in the ledger');
	});

	it('reports every cause when several stack, without double-counting', () => {
		const r = explainTieOut({
			openingCentavos: 500_000,
			storedCentavos: 1_000_000, // 5,000 opening + 4,000 movements + 1,000 drift
			ledgerCentavos: 100_000, // only 1,000 of the 4,000 movements posted; opening not posted
			movementNetCentavos: 400_000,
			unpostedNetCentavos: 300_000,
			noCoaLink: false
		});
		expect(r).toHaveLength(3);
		expect(r[0]).toContain('Stored balance is ₱1,000.00 above'); // 1,000,000 − (500,000 + 400,000)
		expect(r[1]).toContain('₱3,000.00 of movements have no journal entry');
		expect(r[2]).toContain("The ₱5,000.00 opening balance isn't in the ledger yet");
	});

	it('flags an account with no chart-of-accounts link', () => {
		expect(explainTieOut({ ...ok, ledgerCentavos: 0, noCoaLink: true })[0]).toContain('Not linked');
	});
});

describe('findUnresolvedDays', () => {
	const base = { anchor: '2026-09-20', before: '2026-09-24', activityDates: [], closedDates: [], zDates: [] };

	it('never blocks a hotel that has never closed a day', () => {
		expect(
			findUnresolvedDays({ ...base, anchor: null, activityDates: ['2026-09-10', '2026-09-22'] })
		).toEqual([]);
	});

	it('flags an earlier day with activity that is not closed, oldest first', () => {
		expect(
			findUnresolvedDays({
				...base,
				activityDates: ['2026-09-23', '2026-09-22'],
				closedDates: ['2026-09-20'],
				zDates: ['2026-09-20']
			})
		).toEqual([
			{ businessDate: '2026-09-22', kind: 'unclosed' },
			{ businessDate: '2026-09-23', kind: 'unclosed' }
		]);
	});

	it('ignores dark days (no activity, never closed) and days before the first close', () => {
		expect(
			findUnresolvedDays({
				...base,
				activityDates: ['2026-09-05', '2026-09-22'],
				closedDates: ['2026-09-20', '2026-09-22'],
				zDates: ['2026-09-20', '2026-09-22']
			})
		).toEqual([]);
	});

	it('flags a closed day whose Z-reading was never issued', () => {
		expect(
			findUnresolvedDays({
				...base,
				activityDates: ['2026-09-22'],
				closedDates: ['2026-09-20', '2026-09-22'],
				zDates: ['2026-09-20']
			})
		).toEqual([{ businessDate: '2026-09-22', kind: 'no_z' }]);
	});

	it('treats the target day and later days as out of scope', () => {
		expect(findUnresolvedDays({ ...base, activityDates: ['2026-09-24', '2026-09-25'] })).toEqual([]);
	});

	it('counts a reopened first day as unclosed, since it is no longer in the closed set', () => {
		expect(
			findUnresolvedDays({ ...base, activityDates: ['2026-09-20'], closedDates: [], zDates: ['2026-09-20'] })
		).toEqual([{ businessDate: '2026-09-20', kind: 'unclosed' }]);
	});
});

describe('unresolvedDayMessage', () => {
	it('names the day to close first', () => {
		expect(unresolvedDayMessage({ businessDate: '2026-09-22', kind: 'unclosed' }, '2026-09-23')).toContain(
			'Close 2026-09-22 first'
		);
	});
	it('points at the readings page for a missing Z', () => {
		const m = unresolvedDayMessage({ businessDate: '2026-09-22', kind: 'no_z' }, '2026-09-23');
		expect(m).toContain('2026-09-22 is closed but has no Z-reading');
		expect(m).toContain('before closing 2026-09-23');
	});
});

describe('isClosedOnBehalf', () => {
	it('is false when the opener closes their own shift', () => {
		expect(isClosedOnBehalf('u1', 'u1')).toBe(false);
	});
	it('is true when someone else closes it', () => {
		expect(isClosedOnBehalf('u1', 'u2')).toBe(true);
	});
	it('is false when the opener is unknown (nobody to close on behalf of)', () => {
		expect(isClosedOnBehalf(null, 'u2')).toBe(false);
	});
});

describe('inputVatOf', () => {
	it('splits VAT-inclusive gross at 12% (1200 bps)', () => {
		// 1,120.00 gross → 120.00 VAT
		expect(inputVatOf(112_000, 1200)).toBe(12_000);
	});
	it('rounds to the nearest centavo', () => {
		expect(inputVatOf(100_00, 1200)).toBe(Math.round((10_000 * 1200) / 11_200));
	});
	it('is zero at a zero rate', () => {
		expect(inputVatOf(100_000, 0)).toBe(0);
	});
});

describe('advanceDueDate', () => {
	it('adds 7 days for weekly', () => {
		expect(advanceDueDate('2026-09-07', 'weekly', 0)).toBe('2026-09-14');
	});
	it('moves to the anchor day next month for monthly', () => {
		expect(advanceDueDate('2026-01-15', 'monthly', 15)).toBe('2026-02-15');
	});
	it('clamps the anchor day to the shorter month', () => {
		expect(advanceDueDate('2026-01-31', 'monthly', 31)).toBe('2026-02-28');
	});
	it('advances a quarter and a year', () => {
		expect(advanceDueDate('2026-01-10', 'quarterly', 10)).toBe('2026-04-10');
		expect(advanceDueDate('2026-01-10', 'annually', 10)).toBe('2027-01-10');
	});
});

describe('expectedShiftCash', () => {
	it('is float + cash in − cash out', () => {
		expect(expectedShiftCash(500_000, 1_200_000, 300_000)).toBe(1_400_000);
	});
	it('variance is counted − expected', () => {
		const expected = expectedShiftCash(500_000, 1_000_000, 0);
		expect(1_499_500 - expected).toBe(-500); // short by ₱5
	});
});

describe('changeFor', () => {
	it('returns the overpayment on a cash tender', () => {
		expect(changeFor(200_000, 175_050)).toBe(24_950);
	});
	it('never goes negative', () => {
		expect(changeFor(100_000, 150_000)).toBe(0);
	});
});

describe('toCsv', () => {
	it('quotes fields with commas, quotes and newlines', () => {
		const csv = toCsv(
			['a', 'b'],
			[
				['plain', 'has, comma'],
				['has "quote"', 'line\nbreak']
			]
		);
		expect(csv).toBe('a,b\r\nplain,"has, comma"\r\n"has ""quote""","line\nbreak"');
	});
});
