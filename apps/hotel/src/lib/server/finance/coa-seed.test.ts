import { describe, expect, it } from 'vitest';
import { accountSubtype } from '@mm/finance-core';
import {
	COA_SEED,
	CASH_ACCOUNT_KIND_TO_COA_CODE,
	CASH_CATEGORY_TO_COA_CODE,
	EXPENSE_GROUP_TO_COA_CODE
} from './coa-seed';

const codes = new Set(COA_SEED.map((a) => a.code));

describe('COA_SEED', () => {
	it('has no duplicate codes', () => {
		expect(codes.size).toBe(COA_SEED.length);
	});

	it('every account has a subtype from @mm/finance-core\'s accountSubtype enum', () => {
		for (const a of COA_SEED) {
			expect(accountSubtype.safeParse(a.subtype).success, `${a.code} ${a.name}: subtype "${a.subtype}"`).toBe(true);
		}
	});
});

describe('CASH_CATEGORY_TO_COA_CODE', () => {
	// Object.keys over a Record<CashCategory, string> is already exhaustive at
	// compile time — this guards against a typo'd *code* the type system can't catch.
	it('maps every category to a real seeded account code', () => {
		for (const [category, code] of Object.entries(CASH_CATEGORY_TO_COA_CODE)) {
			expect(codes.has(code), `category "${category}" maps to missing code "${code}"`).toBe(true);
		}
	});
});

describe('EXPENSE_GROUP_TO_COA_CODE', () => {
	it('maps every group to a real seeded account code', () => {
		for (const [group, code] of Object.entries(EXPENSE_GROUP_TO_COA_CODE)) {
			expect(codes.has(code), `group "${group}" maps to missing code "${code}"`).toBe(true);
		}
	});
});

describe('CASH_ACCOUNT_KIND_TO_COA_CODE', () => {
	it('maps every cash-account kind to a real seeded account code', () => {
		for (const [kind, code] of Object.entries(CASH_ACCOUNT_KIND_TO_COA_CODE)) {
			expect(codes.has(code), `kind "${kind}" maps to missing code "${code}"`).toBe(true);
		}
	});
});
