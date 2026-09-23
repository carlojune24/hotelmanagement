import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	SecretsError,
	decryptWithKey,
	encryptWithKey,
	maskSecret,
	parseMasterKey
} from './secrets';

const key = randomBytes(32);

describe('secret encryption', () => {
	it('round-trips', () => {
		const stored = encryptWithKey(key, 'sk_test_abc123');
		expect(stored.startsWith('v1:')).toBe(true);
		expect(stored).not.toContain('sk_test_abc123');
		expect(decryptWithKey(key, stored)).toBe('sk_test_abc123');
	});

	it('uses a fresh IV every time', () => {
		expect(encryptWithKey(key, 'same')).not.toBe(encryptWithKey(key, 'same'));
	});

	it('rejects a tampered ciphertext', () => {
		const [v, iv, tag, ct] = encryptWithKey(key, 'secret').split(':');
		const flipped = Buffer.from(ct!, 'base64');
		flipped[0] = flipped[0]! ^ 0xff;
		expect(() => decryptWithKey(key, [v, iv, tag, flipped.toString('base64')].join(':'))).toThrow(
			SecretsError
		);
	});

	it('rejects the wrong master key', () => {
		const stored = encryptWithKey(key, 'secret');
		expect(() => decryptWithKey(randomBytes(32), stored)).toThrow(SecretsError);
	});

	it('rejects an unknown format', () => {
		expect(() => decryptWithKey(key, 'plaintext')).toThrow(SecretsError);
	});
});

describe('parseMasterKey', () => {
	it('requires a key', () => expect(() => parseMasterKey(undefined)).toThrow(SecretsError));
	it('requires 32 bytes', () =>
		expect(() => parseMasterKey(randomBytes(16).toString('base64'))).toThrow(SecretsError));
	it('accepts 32 bytes', () =>
		expect(parseMasterKey(key.toString('base64')).equals(key)).toBe(true));
});

describe('maskSecret', () => {
	it('keeps the PayMongo prefix and last 4', () => {
		expect(maskSecret('sk_live_1234567890abcd')).toBe('sk_live_…abcd');
		expect(maskSecret('whsk_test_zzzzzzzz9876')).toBe('whsk_test_…9876');
	});
	it('masks a plain password to its last 4', () =>
		expect(maskSecret('hunter2hunter')).toBe('…nter'));
	it('hides short values entirely', () => expect(maskSecret('short')).toBe('••••'));
});
