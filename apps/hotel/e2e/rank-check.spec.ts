/**
 * Rank check: searches each keyword once and records where the site appears. It never clicks a result
 * (no fake clicks or visits to inflate traffic); the only visit to the site is one live-site smoke check.
 * Needs internet; no dev server. Results go to the console and e2e/rank-check-results.json.
 *
 *   pnpm exec playwright test e2e/rank-check.spec.ts
 *   RANK_DOMAIN=example.com RANK_KEYWORDS="hotel in tandag,tandag hotel booking" ... to override
 *
 * Run it occasionally (weekly), not on a tight loop: automated queries break search-engine terms and get blocked.
 */
import { writeFileSync } from 'node:fs';
import { expect, test } from 'playwright/test';

const SITE = 'https://mmhotelsbooking.com/';
const DOMAIN = process.env.RANK_DOMAIN ?? new URL(SITE).hostname;
const KEYWORDS = (process.env.RANK_KEYWORDS?.split(',') ?? [
	'mm hotel tandag',
	'hotel in tandag',
	'tandag hotel booking',
	'book hotel tandag online',
	'mmhotel official website'
]).map((k) => k.trim());

test('live site is reachable', async ({ page }) => {
	const res = await page.goto(SITE);
	expect(res?.ok()).toBe(true);
	console.log(`[rank-check] ${SITE} -> ${res?.status()} "${await page.title()}"`);
});

test('keyword rank report', async ({ page }) => {
	test.setTimeout(KEYWORDS.length * 30_000 + 30_000);
	const rows: { keyword: string; position: number | null; note?: string }[] = [];

	for (const keyword of KEYWORDS) {
		await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`);
		const hrefs = await page.locator('a.result__a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
		if (!hrefs.length) {
			rows.push({ keyword, position: null, note: 'no results parsed (blocked or captcha?)' });
		} else {
			// DDG wraps result links as /l/?uddg=<encoded url>.
			const urls = hrefs.map((h) => decodeURIComponent(new URL(h).searchParams.get('uddg') ?? h));
			const i = urls.findIndex((u) => new URL(u).hostname.replace(/^www\./, '') === DOMAIN);
			rows.push({ keyword, position: i < 0 ? null : i + 1, note: i < 0 ? `not in top ${urls.length}` : undefined });
		}
		await page.waitForTimeout(3000 + Math.random() * 2000); // be polite
	}

	console.table(rows);
	writeFileSync('e2e/rank-check-results.json', JSON.stringify({ at: new Date().toISOString(), domain: DOMAIN, rows }, null, 2));
});
