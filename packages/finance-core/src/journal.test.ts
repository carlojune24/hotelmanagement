import { describe, expect, it } from 'vitest';
import { assertBalanced, type JournalEntryDraft } from './journal';

const orgRef = 'org_01J9Z00000000000000000000';
const acct = (n: number) => `acct_01J9Z0000000000000000000${n}`;

function draft(lines: { debit_minor: number; credit_minor: number }[]): JournalEntryDraft {
	return {
		date: '2026-01-01',
		source_type: 'manual',
		lines: lines.map((l, i) => ({
			account_ref: acct(i) as JournalEntryDraft['lines'][number]['account_ref'],
			debit_minor: l.debit_minor,
			credit_minor: l.credit_minor,
			currency: 'PHP',
			dimensions: { org_ref: orgRef as never, hotel_id: '00000000-0000-4000-8000-000000000000' }
		}))
	};
}

describe('assertBalanced', () => {
	it('accepts a balanced two-line entry', () => {
		expect(() => assertBalanced(draft([{ debit_minor: 100, credit_minor: 0 }, { debit_minor: 0, credit_minor: 100 }]))).not.toThrow();
	});

	it('rejects debits != credits', () => {
		expect(() => assertBalanced(draft([{ debit_minor: 100, credit_minor: 0 }, { debit_minor: 0, credit_minor: 90 }]))).toThrow(
			/does not balance/
		);
	});

	it('rejects a line with both debit and credit set', () => {
		expect(() => assertBalanced(draft([{ debit_minor: 100, credit_minor: 50 }, { debit_minor: 0, credit_minor: 50 }]))).toThrow(
			/exactly one/
		);
	});

	it('rejects a line with neither debit nor credit set', () => {
		expect(() => assertBalanced(draft([{ debit_minor: 0, credit_minor: 0 }, { debit_minor: 0, credit_minor: 0 }]))).toThrow(
			/exactly one/
		);
	});
});
