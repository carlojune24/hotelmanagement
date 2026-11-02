/** Guest-contact checks shared by the staff forms (live feedback) and the server actions (the real gate). */

const COMMON_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'yahoo.com.ph'];

function distance(a: string, b: string): number {
	const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
	for (let i = 1; i <= a.length; i++)
		for (let j = 1; j <= b.length; j++)
			dp[i]![j] = Math.min(
				dp[i - 1]![j]! + 1,
				dp[i]![j - 1]! + 1,
				dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
	return dp[a.length]![b.length]!;
}

/** null = fine. Names: at least 2 letters, no digits or symbols beyond . ' - */
export function nameError(v: string): string | null {
	const s = v.trim();
	if (!s) return null; // emptiness is the `required` attribute's job
	if (/\d/.test(s)) return 'A name has no numbers.';
	if (!/^[\p{L}][\p{L}\p{M} .'’-]*$/u.test(s)) return 'Use letters only (spaces, . - \' are fine).';
	if ((s.match(/\p{L}/gu) ?? []).length < 2) return 'Enter the full name.';
	return null;
}

/** `suggestion` is a corrected address when the domain looks like a typo of a common one. */
export function emailCheck(v: string): { error: string | null; suggestion: string | null } {
	const s = v.trim().toLowerCase();
	if (!s) return { error: null, suggestion: null };
	const m = /^([^\s@]+)@([^\s@]+)$/.exec(s);
	if (!m || !/^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(s)) {
		// "name@gmalcom" has no dot — still offer the likely fix when it is one edit away from gmail.com
		const dom = m?.[2]?.replace(/\./g, '');
		const guess = dom && COMMON_DOMAINS.find((d) => distance(dom, d.replace(/\./g, '')) <= 1);
		return {
			error: 'Enter a valid email like name@gmail.com.',
			suggestion: guess && m ? `${m[1]}@${guess}` : null
		};
	}
	const domain = m[2]!;
	const near = COMMON_DOMAINS.find((d) => d !== domain && distance(domain, d) <= 2);
	return near
		? { error: `Did you mean ${near}?`, suggestion: `${m[1]}@${near}` }
		: { error: null, suggestion: null };
}

/** PH mobile (09XXXXXXXXX / +639XXXXXXXXX) or any international +number. */
export function phoneError(v: string): string | null {
	const s = v.replace(/[\s()-]/g, '');
	if (!s) return null;
	if (/^(09\d{9}|\+?639\d{9}|\+\d{7,15})$/.test(s)) return null;
	return 'Enter a mobile like 09171234567 (or +country code).';
}
