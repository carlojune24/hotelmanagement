import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderSigninCodeEmail } from '../email/signin-code';
import { codeMatches, generateCode, hashCode, maskEmail, normalizeCode } from './otp';
import { cleanupTestOrg, createTestOrg } from '../hr/test-helpers';

describe('sign-in code, pure parts', () => {
	it('is always six digits, zero-padded', () => {
		for (let i = 0; i < 2000; i++) expect(generateCode()).toMatch(/^\d{6}$/);
	});

	it('hashes a code against the challenge it belongs to', () => {
		expect(hashCode('a', '123456')).toBe(hashCode('a', '123456'));
		expect(hashCode('a', '123456')).not.toBe(hashCode('b', '123456'));
		expect(hashCode('a', '123456')).not.toBe(hashCode('a', '123457'));
	});

	it('accepts the code typed with spaces or a dash, and nothing else', () => {
		const stored = hashCode('c1', '048215');
		expect(codeMatches('c1', stored, '048215')).toBe(true);
		expect(codeMatches('c1', stored, ' 048 215 ')).toBe(true);
		expect(codeMatches('c1', stored, '048-215')).toBe(true);
		expect(codeMatches('c1', stored, '48215')).toBe(false);
		expect(codeMatches('c1', stored, '048216')).toBe(false);
		expect(codeMatches('c1', stored, 'abcdef')).toBe(false);
		expect(codeMatches('c1', stored, '')).toBe(false);
		expect(codeMatches('other', stored, '048215')).toBe(false);
		expect(normalizeCode('12 3-4 56')).toBe('123456');
	});

	it('masks an address without losing the domain', () => {
		expect(maskEmail('carlo.caimen@gmail.com')).toBe('c•••••••••@gmail.com');
		expect(maskEmail('ab@x.com')).toBe('a•••@x.com');
	});

	it('writes an email whose subject is the code, with the org name escaped', () => {
		const mail = renderSigninCodeEmail({ orgName: 'Tom & <Jerry>', code: '048215', minutes: 10 });
		expect(mail.subject).toBe('048215 is your Tom & <Jerry> sign-in code');
		expect(mail.text).toContain('048 215');
		expect(mail.text).toContain('10 minutes');
		expect(mail.html).toContain('Tom &amp; &lt;Jerry&gt;');
		expect(mail.html).not.toContain('<Jerry>');
	});
});

describe('account page actions', () => {
	it('uses only named actions (password and recovery codes live on one page)', async () => {
		const { actions } = await import('../../../routes/(app)/account/+page.server');
		const names = Object.keys(actions as object);
		expect(names).toEqual(expect.arrayContaining(['password', 'recovery']));
		expect(names).not.toContain('default');
	});
});

describe('verify page actions', () => {
	// SvelteKit refuses a page that has both a default action and named ones (a 500 at run time).
	it('uses only named actions, so the Resend button can sit beside Verify', async () => {
		const { actions } = await import('../../../routes/auth/login/verify/+page.server');
		const names = Object.keys(actions as object);
		expect(names).toContain('verify');
		expect(names).toContain('resend');
		expect(names).not.toContain('default');
	});
});

const hasDb = Boolean(process.env.DATABASE_URL) || (await hasEnvFile());
async function hasEnvFile(): Promise<boolean> {
	try {
		const { env } = await import('$env/dynamic/private');
		return Boolean(env.DATABASE_URL);
	} catch {
		return false;
	}
}

describe.skipIf(!hasDb)('sign-in code, the whole flow (live DB, local mail sink)', async () => {
	const { db } = await import('$lib/server/db/index');
	const { loginChallenges, users, emailSettings } = await import('$lib/server/db/schema/index');
	const { eq } = await import('drizzle-orm');
	const O = await import('./otp');
	const S = await import('../email/settings');
	const { startSmtpSink, lastCode } = await import('./smtp-sink');
	const { hashOpaqueToken } = await import('$lib/server/crypto');

	let org = '';
	let userId = '';
	const email = `otp-${Math.random().toString(36).slice(2, 8)}@example.test`;
	let sink: Awaited<ReturnType<typeof startSmtpSink>>;

	const startFull = () => O.startChallenge({ user: { id: userId, email }, next: '/payroll', organizationId: org, orgName: 'OTP test' });
	const start = async () => (await startFull()).token;
	const idOf = (token: string) => hashOpaqueToken(token);

	beforeAll(async () => {
		sink = await startSmtpSink();
		org = await createTestOrg();
		const [u] = await db.insert(users).values({ email, name: 'OTP Tester', passwordHash: 'x' }).returning({ id: users.id });
		userId = u!.id;
		await S.saveEmailSettings(
			org,
			{ host: '127.0.0.1', port: sink.port, secure: false, username: null, password: null, fromName: null, fromAddress: 'hr@example.test', replyTo: null },
			null
		);
	});
	afterAll(async () => {
		await db.delete(users).where(eq(users.id, userId));
		await db.delete(emailSettings).where(eq(emailSettings.organizationId, org));
		await cleanupTestOrg(org);
		await sink.close();
	});

	it('is not required until the mailbox has passed a test and the switch is on', async () => {
		expect(await O.signinCodeRequired(org)).toBe(false);
		await expect(S.setSigninCodeRequired(org, true, null)).rejects.toThrow(/test email/);
		const test = await S.sendTestEmail(org, 'OTP test', email);
		expect(test.ok).toBe(true);
		expect(sink.mails.at(-1)).toContain('test email');
		await S.setSigninCodeRequired(org, true, null);
		expect(await O.signinCodeRequired(org)).toBe(true);
	});

	it('saving the mailbox again switches the requirement off until it is re-tested', async () => {
		await S.saveEmailSettings(
			org,
			{ host: '127.0.0.1', port: sink.port, secure: false, username: null, password: null, fromName: null, fromAddress: 'hr@example.test', replyTo: null },
			null
		);
		expect(await O.signinCodeRequired(org)).toBe(false);
		await S.sendTestEmail(org, 'OTP test', email);
		await S.setSigninCodeRequired(org, true, null);
	});

	it('emails a code that signs in once, and carries the page to go to', async () => {
		const token = await start();
		const code = lastCode(sink.mails)!;
		expect(code).toMatch(/^\d{6}$/);
		expect((await O.challengeFor(token))?.email).toBe(email);
		const wrong = code === '000000' ? '000001' : '000000';
		expect(await O.verifyChallenge(token, wrong)).toEqual({ ok: false, reason: 'wrong', attemptsLeft: 4 });
		expect(await O.verifyChallenge(token, ` ${code.slice(0, 3)} ${code.slice(3)} `)).toEqual({ ok: true, userId, next: '/payroll', recovery: false });
		// Used once: the same code is gone.
		expect(await O.verifyChallenge(token, code)).toEqual({ ok: false, reason: 'missing' });
	});

	it('locks after 5 wrong tries, even if the sixth is right', async () => {
		const token = await start();
		const code = lastCode(sink.mails)!;
		const wrong = code === '111111' ? '222222' : '111111';
		const results = [];
		for (let i = 0; i < 5; i++) results.push(await O.verifyChallenge(token, wrong));
		expect(results.map((r) => (r.ok ? 'ok' : r.reason))).toEqual(['wrong', 'wrong', 'wrong', 'wrong', 'locked']);
		expect(await O.verifyChallenge(token, code)).toEqual({ ok: false, reason: 'missing' });
	});

	it('does not accept a code after it expired', async () => {
		const token = await start();
		const code = lastCode(sink.mails)!;
		await db.update(loginChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(loginChallenges.id, idOf(token)));
		expect(await O.challengeFor(token)).toBeNull();
		expect(await O.verifyChallenge(token, code)).toEqual({ ok: false, reason: 'expired' });
	});

	it('re-sends a fresh code only after the wait, replacing the old one, and at most 5 in all', async () => {
		const token = await start();
		const first = lastCode(sink.mails)!;
		const early = await O.resendChallenge(token, org, 'OTP test');
		expect(early).toMatchObject({ ok: false, reason: 'wait' });

		const id = idOf(token);
		const longAgo = () => db.update(loginChallenges).set({ lastSentAt: new Date(Date.now() - 61_000) }).where(eq(loginChallenges.id, id));
		await longAgo();
		expect(await O.resendChallenge(token, org, 'OTP test')).toEqual({ ok: true });
		let second = lastCode(sink.mails)!;
		// A new code is issued; the old one no longer works (unless it happened to repeat).
		if (second !== first) expect(await O.verifyChallenge(token, first)).toMatchObject({ ok: false, reason: 'wrong' });
		for (let i = 0; i < 3; i++) {
			await longAgo();
			expect(await O.resendChallenge(token, org, 'OTP test')).toEqual({ ok: true });
		}
		await longAgo();
		expect(await O.resendChallenge(token, org, 'OTP test')).toEqual({ ok: false, reason: 'limit' });
		second = lastCode(sink.mails)!;
		expect(await O.verifyChallenge(token, second)).toMatchObject({ ok: true, userId });
	});

	it('lets a recovery code stand in for the emailed code, once', async () => {
		const R = await import('./recovery');
		const codes = await R.issueRecoveryCodes(userId);
		expect(codes).toHaveLength(8);
		expect(await R.recoverySummary(userId)).toEqual({ unused: 8, total: 8 });

		const token = await start();
		// Typed in lower case without the dash, as someone reading it off paper might.
		const typed = codes[0]!.replace('-', '').toLowerCase();
		expect(await O.verifyChallenge(token, typed)).toEqual({ ok: true, userId, next: '/payroll', recovery: true });
		expect(await R.recoverySummary(userId)).toEqual({ unused: 7, total: 8 });

		// The same code does not work a second time, and counts as a wrong try.
		const again = await start();
		expect(await O.verifyChallenge(again, codes[0]!)).toMatchObject({ ok: false, reason: 'wrong', attemptsLeft: 4 });
		// Another unused code still works.
		expect(await O.verifyChallenge(again, codes[1]!)).toMatchObject({ ok: true, recovery: true });
	});

	it('a recovery code is only good for its own owner, and a new set replaces the old', async () => {
		const R = await import('./recovery');
		const [other] = await db.insert(users).values({ email: `other-${email}`, name: 'Other', passwordHash: 'x' }).returning({ id: users.id });
		try {
			const mine = await R.issueRecoveryCodes(userId);
			expect(await R.consumeRecoveryCode(other!.id, mine[2]!)).toBe(false);
			const fresh = await R.issueRecoveryCodes(userId);
			expect(await R.consumeRecoveryCode(userId, mine[2]!)).toBe(false);
			expect(await R.consumeRecoveryCode(userId, fresh[2]!)).toBe(true);
			expect(await R.consumeRecoveryCode(userId, fresh[2]!)).toBe(false);
		} finally {
			await db.delete(users).where(eq(users.id, other!.id));
		}
	});

	it('counts recovery guesses against the same 5 tries, so they cannot be brute-forced', async () => {
		const token = await start();
		const results = [];
		for (let i = 0; i < 5; i++) results.push(await O.verifyChallenge(token, 'ZZZZ-ZZZZ'));
		expect(results.map((r) => (r.ok ? 'ok' : r.reason))).toEqual(['wrong', 'wrong', 'wrong', 'wrong', 'locked']);
	});

	it('a newer sign-in replaces an unfinished one', async () => {
		const older = await start();
		const newer = await start();
		expect(await O.challengeFor(older)).toBeNull();
		expect(await O.challengeFor(newer)).not.toBeNull();
	});

	it('keeps the sign-in alive when the mailbox is down, so a recovery code still gets the person in', async () => {
		const R = await import('./recovery');
		const codes = await R.issueRecoveryCodes(userId);
		await db.update(emailSettings).set({ port: 1 }).where(eq(emailSettings.organizationId, org));
		const { token, emailed } = await startFull();
		expect(emailed).toBe(false);
		expect(await O.challengeFor(token)).not.toBeNull();
		// No email arrived, but the recovery code works and signs in.
		expect(await O.verifyChallenge(token, codes[3]!)).toMatchObject({ ok: true, userId, recovery: true });
	});
});
