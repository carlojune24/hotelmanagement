import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	MAX_MONEY_PHP,
	RATE_MESSAGES,
	TIME_OF_DAY,
	friendlyIssue,
	moneyPhp,
	optMoneyPhp,
	recordId,
	timeOfDay
} from './rate-validation';

describe('moneyPhp', () => {
	const schema = moneyPhp();

	it('accepts ordinary amounts, zero, and the cap itself', () => {
		expect(schema.parse('4500')).toBe(4500);
		expect(schema.parse('0')).toBe(0);
		expect(schema.parse('1234.56')).toBe(1234.56);
		expect(schema.parse(String(MAX_MONEY_PHP))).toBe(MAX_MONEY_PHP);
	});

	it('rejects an amount over the cap, including values that would overflow a bigint', () => {
		for (const v of ['1000000.01', '50000000', '1e30', '1e308']) {
			const r = schema.safeParse(v);
			expect(r.success, v).toBe(false);
			expect(r.error?.issues[0]?.message).toBe(RATE_MESSAGES.moneyTooBig);
		}
	});

	it('rejects negatives, Infinity and non-numbers with a readable message', () => {
		expect(schema.safeParse('-1').error?.issues[0]?.message).toBe(RATE_MESSAGES.moneyNegative);
		expect(schema.safeParse('Infinity').error?.issues[0]?.message).toBe(RATE_MESSAGES.moneyInvalid);
		expect(schema.safeParse('abc').error?.issues[0]?.message).toBe(RATE_MESSAGES.moneyInvalid);
	});
});

describe('optMoneyPhp', () => {
	it('treats blank / missing as not provided, but still enforces the cap', () => {
		const s = z.object({ fee: optMoneyPhp });
		expect(s.parse({ fee: '' }).fee).toBeUndefined();
		expect(s.parse({}).fee).toBeUndefined();
		expect(s.parse({ fee: '250' }).fee).toBe(250);
		expect(s.safeParse({ fee: '2000000' }).success).toBe(false);
	});
});

describe('timeOfDay', () => {
	const schema = timeOfDay();
	it('accepts every real time on the 24-hour clock', () => {
		for (const v of ['00:00', '09:05', '12:00', '14:30', '23:59']) expect(schema.safeParse(v).success, v).toBe(true);
	});
	it('rejects impossible times and the wrong shape', () => {
		for (const v of ['24:00', '25:00', '99:99', '12:60', '1:30', '12:5', '12:00:00', '', 'noon'])
			expect(schema.safeParse(v).success, v).toBe(false);
	});
	it('exposes the same rule as a regex', () => {
		expect(TIME_OF_DAY.test('23:59')).toBe(true);
		expect(TIME_OF_DAY.test('24:00')).toBe(false);
	});
});

describe('recordId', () => {
	it('accepts a UUID and rejects anything else', () => {
		expect(recordId().safeParse('3f0e8a52-9c1d-4b7e-8a63-5d2f1c9b7a10').success).toBe(true);
		for (const v of ['', 'abc', '123', "1' or '1'='1"]) expect(recordId().safeParse(v).success, v).toBe(false);
	});
});

describe('friendlyIssue', () => {
	it('returns our readable message when one of our rules failed', () => {
		const r = z.object({ price: moneyPhp() }).safeParse({ price: '9999999' });
		expect(friendlyIssue(r.error!, 'fallback')).toBe(RATE_MESSAGES.moneyTooBig);
	});
	it('falls back when only generic zod wording is available', () => {
		const r = z.object({ name: z.string().min(2) }).safeParse({ name: 'a' });
		expect(friendlyIssue(r.error!, 'Check the plan and try again.')).toBe('Check the plan and try again.');
	});
});
