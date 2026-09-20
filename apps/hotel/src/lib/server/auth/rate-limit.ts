/** In-memory fixed-window limiter for the unauthenticated auth endpoints (login, invite-accept).
 *
 *  Process-local: a restart clears it and multiple app instances don't share counts. That's
 *  acceptable for brute-force throttling on a single-node deploy; move to a shared store
 *  (Postgres / `pg-boss`) if the app ever runs horizontally. Only *failures* are recorded, and
 *  a success clears the key, so a legitimate user is never penalised for prior good logins. */

export interface RateLimitRule {
	/** Failures allowed inside the window before further attempts are blocked. */
	max: number;
	windowMs: number;
}

interface Entry {
	count: number;
	resetAt: number;
}

export class RateLimiter {
	private entries = new Map<string, Entry>();

	constructor(
		private rule: RateLimitRule,
		private now: () => number = Date.now
	) {}

	/** Seconds until `key` may try again, or 0 if it isn't currently blocked. */
	retryAfter(key: string): number {
		const e = this.live(key);
		if (!e || e.count < this.rule.max) return 0;
		return Math.max(1, Math.ceil((e.resetAt - this.now()) / 1000));
	}

	recordFailure(key: string): void {
		const e = this.live(key);
		if (e) e.count += 1;
		else this.entries.set(key, { count: 1, resetAt: this.now() + this.rule.windowMs });
		if (this.entries.size > 10_000) this.sweep();
	}

	reset(key: string): void {
		this.entries.delete(key);
	}

	private live(key: string): Entry | undefined {
		const e = this.entries.get(key);
		if (e && e.resetAt <= this.now()) {
			this.entries.delete(key);
			return undefined;
		}
		return e;
	}

	private sweep(): void {
		const t = this.now();
		for (const [k, e] of this.entries) if (e.resetAt <= t) this.entries.delete(k);
	}
}

const MIN = 60_000;

/** Per (email, ip): stops guessing one account's password from one place. */
export const loginByAccount = new RateLimiter({ max: 5, windowMs: 15 * MIN });
/** Per ip: stops spraying many accounts from one place. Generous, because behind a reverse
 *  proxy without `ADDRESS_HEADER`/`XFF_DEPTH` set, every visitor shares the proxy's IP. */
export const loginByIp = new RateLimiter({ max: 30, windowMs: 15 * MIN });
/** Per ip, invite-accept: tokens are high-entropy, so this is just abuse damping. */
export const inviteByIp = new RateLimiter({ max: 10, windowMs: 15 * MIN });

const accountKey = (ip: string, email: string) => `${ip}|${email.trim().toLowerCase()}`;

/** Seconds the caller must wait before another login attempt, or 0. */
export function loginRetryAfter(ip: string, email: string): number {
	return Math.max(loginByAccount.retryAfter(accountKey(ip, email)), loginByIp.retryAfter(ip));
}
export function loginFailed(ip: string, email: string): void {
	loginByAccount.recordFailure(accountKey(ip, email));
	loginByIp.recordFailure(ip);
}
/** Clears the account counter only — the per-IP one keeps counting so a spray attack that
 *  lands one real login can't reset itself. */
export function loginSucceeded(ip: string, email: string): void {
	loginByAccount.reset(accountKey(ip, email));
}

export function tooManyMessage(retryAfterSeconds: number): string {
	const mins = Math.ceil(retryAfterSeconds / 60);
	return `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
}
