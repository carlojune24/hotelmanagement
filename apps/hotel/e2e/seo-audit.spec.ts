/**
 * SEO audit of the public guest pages: title, description, canonical, og tags, h1, JSON-LD, image alts, robots.
 * It reads pages only (no traffic faking). Prerequisite: `pnpm dev` running with the seed hotel published.
 *
 *   pnpm exec playwright test e2e/seo-audit.spec.ts                 one pass, fails on any problem
 *   SEO_LOOP=1 pnpm exec playwright test e2e/seo-audit.spec.ts      re-audits every SEO_LOOP_MS (default 5 min) until Ctrl+C
 */
import { expect, test } from 'playwright/test';
import { SLUG } from './helpers';

const LOOP = !!process.env.SEO_LOOP;
const LOOP_MS = Number(process.env.SEO_LOOP_MS ?? 300_000);

test.setTimeout(LOOP ? 0 : 120_000);

test('seo audit', async ({ page, request }) => {
	do {
		const problems: string[] = [];
		const check = (path: string, ok: boolean, msg: string) => ok || problems.push(`${path}: ${msg}`);

		// Home first: it also tells us the room-type pages to audit.
		const paths = [`/${SLUG}`, `/${SLUG}/contact`, `/${SLUG}/dining`, `/${SLUG}/meetings-events`];
		await page.goto(paths[0]);
		const roomHref = await page.locator(`a[href*="/rooms/"]`).first().getAttribute('href').catch(() => null);
		if (roomHref) paths.push(roomHref);

		for (const path of paths) {
			const res = await page.goto(path);
			if (path !== paths[0] && res?.status() === 404) continue; // dining / halls are optional per hotel
			check(path, res?.ok() ?? false, `status ${res?.status()}`);

			const title = await page.title();
			check(path, title.length >= 20 && title.length <= 70, `title length ${title.length} ("${title}")`);
			const meta = (sel: string) => page.locator(sel).first().getAttribute('content').catch(() => null);
			const desc = (await meta('meta[name="description"]')) ?? '';
			check(path, desc.length >= 50 && desc.length <= 160, `description length ${desc.length}`);
			for (const p of ['og:title', 'og:description', 'og:url']) check(path, !!(await meta(`meta[property="${p}"]`)), `missing ${p}`);
			check(path, (await page.locator('h1').count()) === 1, 'expected exactly one h1');
			const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
			check(path, !!canonical && /^https?:\/\//.test(canonical), `canonical not absolute (${canonical})`);
			check(path, (await page.locator('meta[name="robots"][content*="noindex"]').count()) === 0, 'unexpected noindex');

			for (const ld of await page.locator('script[type="application/ld+json"]').allTextContents()) {
				try {
					check(path, !!JSON.parse(ld)['@type'], 'JSON-LD without @type');
				} catch {
					check(path, false, 'JSON-LD is not valid JSON');
				}
			}
			if (path === roomHref) check(path, (await page.locator('script[type="application/ld+json"]').allTextContents()).some((t) => t.includes('"HotelRoom"')), 'no HotelRoom JSON-LD');
			// Decorative images are alt="" on purpose; only an img with no alt attribute at all is a problem.
			check(path, (await page.locator('img:not([alt])').count()) === 0, 'img without an alt attribute');
		}

		const robots = await (await request.get('/robots.txt')).text();
		check('/robots.txt', /^Sitemap:/m.test(robots), 'no Sitemap line');
		check('/robots.txt', /Disallow: \/admin/.test(robots), 'does not disallow /admin');
		const sitemap = await request.get('/sitemap.xml');
		check('/sitemap.xml', sitemap.ok() && (await sitemap.text()).includes('<loc>'), 'missing or empty');

		console.log(`[seo-audit ${new Date().toISOString()}] ${problems.length ? problems.join('\n  ') : 'all checks passed'}`);
		if (!LOOP) expect(problems).toEqual([]);
		else await page.waitForTimeout(LOOP_MS);
	} while (LOOP);
});
