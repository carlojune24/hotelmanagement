/** Business-permit tracking — pure logic shared by the pages and tests. */

export const EXPIRING_SOON_DAYS = 60;

export type PermitStatus = 'valid' | 'expiring' | 'expired' | 'none';

export const PERMIT_STATUS_LABEL: Record<PermitStatus, string> = {
	valid: 'Valid',
	expiring: 'Expiring soon',
	expired: 'Expired',
	none: 'No permit on file'
};

const MS_PER_DAY = 86_400_000;
const utc = (s: string) => Date.parse(`${s}T00:00:00Z`);

/** Whole days from `today` to `expiresOn` (negative = already expired). Both are `YYYY-MM-DD`. */
export const daysUntil = (expiresOn: string, today: string) =>
	Math.round((utc(expiresOn) - utc(today)) / MS_PER_DAY);

/** A permit is valid through its expiry date; it is expired from the day after. */
export function permitStatus(expiresOn: string | null | undefined, today: string): PermitStatus {
	if (!expiresOn) return 'none';
	const d = daysUntil(expiresOn, today);
	if (d < 0) return 'expired';
	return d <= EXPIRING_SOON_DAYS ? 'expiring' : 'valid';
}

export type PermitLike = { id: string; hotelId: string; permitNumber: string; expiresOn: string };

/** The permit expiring latest per hotel (ties → most recently listed first wins via input order). */
export function currentPermits<T extends PermitLike>(permits: T[]): Map<string, T> {
	const out = new Map<string, T>();
	for (const p of permits) {
		const cur = out.get(p.hotelId);
		if (!cur || p.expiresOn > cur.expiresOn) out.set(p.hotelId, p);
	}
	return out;
}

export type PermitCounts = Record<PermitStatus, number>;

export function countByStatus(statuses: PermitStatus[]): PermitCounts {
	const c: PermitCounts = { valid: 0, expiring: 0, expired: 0, none: 0 };
	for (const s of statuses) c[s]++;
	return c;
}

export function isPermitStatus(v: unknown): v is PermitStatus {
	return v === 'valid' || v === 'expiring' || v === 'expired' || v === 'none';
}
