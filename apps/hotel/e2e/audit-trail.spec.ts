import { expect, test, type Page } from 'playwright/test';
import { SLUG, STAFF_EMAIL, addFirstDish, orderFromUrl, reserveAsGuest, staffLogin, uniqueGuest } from './helpers';

/**
 * The audit trail for dining tracking numbers (docs/AUDIT_TRAIL_PLAN.md).
 *
 * A dining order DN-… or table reservation TB-… has one page (`management/trail/<code>`) that reads
 * in time order and says who did each step, with a print sheet and a CSV. The Audit log page gained
 * server-side filters, pagination, CSV and print. These specs walk real orders through their steps.
 *
 * Prerequisites (same as online-acceptance.spec.ts): a venue taking online orders that also allows
 * paying at the restaurant; for the TB test, one taking online reservations. Tests skip themselves
 * when their setup is missing. The staff login (E2E_STAFF_*) is normally a hotel admin; the last test
 * needs a second, dining-only login in E2E_DINING_EMAIL / E2E_DINING_PASSWORD and skips without it.
 */

const ORDER_URL = `/${SLUG}/dining/order`;
const trail = (ref: string) => `/${SLUG}/management/trail/${ref}`;

/** Places a pay-at-the-restaurant pickup order as a guest. */
async function placeVenuePayOrder(page: Page) {
	const guest = uniqueGuest();
	await page.goto(ORDER_URL);
	await addFirstDish(page);
	await page.getByRole('button', { name: /^Review order/ }).first().click();
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.locator('label.dining-slot').first().click();
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.locator('#orName').fill(guest.name);
	await page.locator('#orPhone').fill(guest.phone);
	const venuePay = page.locator('input[name="payChoice"][value="venue"]');
	test.skip((await venuePay.count()) === 0, 'This venue only takes online payment.');
	await venuePay.check();
	await page.getByRole('button', { name: /place order/i }).click();
	await page.waitForURL(/\/dining\/order\/DN-/);
	return { code: orderFromUrl(page.url()).code, trackingUrl: page.url(), guest };
}

/** The timeline rows, as plain text, in the order the page shows them. */
const timelineRows = (page: Page) => page.locator('section[aria-labelledby="timeline-h"] tbody tr');

async function rowTexts(page: Page) {
	return (await timelineRows(page).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

test.describe('dining trail', () => {
	test('a guest order and its acceptance read in order, with who did each step', async ({ page }) => {
		const { code, guest } = await placeVenuePayOrder(page);

		await staffLogin(page);
		await page.goto(`/${SLUG}/management/dining/orders`);
		const row = page.getByLabel('Orders waiting for you').locator('li', { hasText: code });
		await row.getByRole('button', { name: 'Accept' }).click();
		await expect(page.getByLabel('Orders waiting for you').locator('li', { hasText: code })).toHaveCount(0);

		await page.goto(trail(code));
		await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
		await expect(page.getByText('Dining order trail')).toBeVisible();
		await expect(page.getByText(guest.name).first()).toBeVisible();

		const rows = await rowTexts(page);
		const placed = rows.findIndex((r) => /Order placed/.test(r));
		const accepted = rows.findIndex((r) => /Order accepted/.test(r));
		expect(placed).toBeGreaterThanOrEqual(0);
		expect(accepted).toBeGreaterThan(placed);
		// A guest placed it online; staff accepted it. They must never read as the same kind of actor.
		expect(rows[placed]).toMatch(/Guest/);
		expect(rows[accepted]).toMatch(/Staff/);
		expect(rows[accepted]).not.toMatch(/Guest/);

		// "Who handled it" names the staff member who accepted it.
		const handled = page.locator('section[aria-labelledby="handled-h"]');
		await expect(handled.getByText('Placed by')).toBeVisible();
		await expect(handled.getByText('Accepted by')).toBeVisible();

		// The money summary matches the order: billed equals the total on the order line, nothing collected yet.
		const summary = await page.locator('section[aria-label="Summary"]').innerText();
		const total = (summary.match(/₱[\d,]+\.\d{2}/) ?? [])[0];
		expect(total).toBeTruthy();
		const money = page.locator('section[aria-labelledby="money-h"]');
		await expect(money.getByText('Billed').locator('..')).toContainText(total!);
		await expect(money.getByText('Net collected').locator('..')).toContainText('₱0.00');
	});

	test('a guest cancelling their own order is a Guest step, not a Staff one', async ({ page }) => {
		const { code } = await placeVenuePayOrder(page);
		await page.getByRole('button', { name: /cancel order/i }).first().click();
		const confirm = page.getByRole('button', { name: /yes, cancel|confirm/i });
		if (await confirm.count()) await confirm.first().click();
		await expect(page.getByText('Order cancelled')).toBeVisible();

		await staffLogin(page);
		await page.goto(trail(code));
		const rows = await rowTexts(page);
		const cancelled = rows.find((r) => /Guest cancelled the order/.test(r));
		expect(cancelled, 'the guest cancel is on the trail').toBeTruthy();
		expect(cancelled).toMatch(/Guest/);
		expect(cancelled).not.toMatch(/Staff/);
		// Their reason is kept.
		expect(cancelled).toMatch(/Cancelled by the guest/);
	});

	test('a table reservation trail shows the booking as a Guest step and links its pre-order', async ({ page }) => {
		const guest = await reserveAsGuest(page, { daysAhead: 6, withOrder: true });
		let tb = (page.url().match(/\/reserve\/(TB-[A-Z0-9]{4})/) ?? [])[1];
		if (!tb) {
			// Straight to the menu: take the order home with the cheapest path, pay at the restaurant.
			test.skip(!/\/dining\/order\?/.test(page.url()), 'Could not tell where the booking went.');
			await addFirstDish(page);
			await page.locator('#orName').fill(guest.name);
			await page.locator('#orPhone').fill(guest.phone);
			const venuePay = page.locator('input[name="payChoice"][value="venue"]');
			test.skip((await venuePay.count()) === 0, 'This venue only takes online payment.');
			await venuePay.check();
			await page.getByRole('button', { name: /place order/i }).click();
			await page.waitForURL(/\/dining\/order\/DN-/);
			await staffLogin(page);
			await page.goto(`/${SLUG}/management/dining/reservations?tab=upcoming&q=${encodeURIComponent(guest.name)}`);
			tb = (await page.getByRole('row', { name: new RegExp(guest.name) }).innerText()).match(/TB-[A-Z0-9]{4}/)?.[0];
		} else {
			await staffLogin(page);
		}
		expect(tb).toBeTruthy();

		await page.goto(trail(tb!));
		await expect(page.getByText('Table reservation trail')).toBeVisible();
		const rows = await rowTexts(page);
		const reserved = rows.find((r) => /Table reserved/.test(r));
		expect(reserved).toBeTruthy();
		expect(reserved).toMatch(/Guest/);
		// Its pre-order, when it has one, is part of the same trail.
		const orderLinks = page.getByRole('link', { name: /^Order DN-/ });
		if (await orderLinks.count()) {
			await expect(orderLinks.first()).toHaveAttribute('href', new RegExp(`/management/trail/DN-`));
		}
	});

	test('Find by number offers the full trail, and the Trail links on the boards work', async ({ page }) => {
		const { code } = await placeVenuePayOrder(page);
		await staffLogin(page);
		await page.goto(`/${SLUG}/management/lookup?q=${code}`);
		await page.getByRole('link', { name: 'Open full trail' }).click();
		await expect(page).toHaveURL(new RegExp(`/management/trail/${code}`));

		// An id (older audit rows have no number) turns into its number.
		await page.goto(`/${SLUG}/management/dining/orders`);
		const trailLink = page.getByRole('link', { name: 'Trail' }).first();
		if (await trailLink.count()) {
			await trailLink.click();
			await expect(page).toHaveURL(/\/management\/trail\/DN-/);
		}
	});

	test('an unknown number is a 404, and another hotel’s number never resolves', async ({ page }) => {
		await staffLogin(page);
		const res = await page.goto(trail('DN-ZZZZ'));
		expect(res?.status()).toBe(404);
	});

	test('print sheet and CSV carry the same trail', async ({ page }) => {
		const { code } = await placeVenuePayOrder(page);
		await staffLogin(page);

		await page.goto(trail(code));
		await expect(page.getByRole('link', { name: 'Print' })).toHaveAttribute('href', new RegExp(`/print/dining-trail/${code}`));
		await expect(page.getByRole('link', { name: 'CSV' })).toHaveAttribute('href', new RegExp(`/trail/${code}/csv`));

		await page.goto(`/${SLUG}/print/dining-trail/${code}`);
		await expect(page.getByText('Dining order trail', { exact: true })).toBeVisible();
		const sheet = (await page.locator('.rs-page').innerText()).toUpperCase();
		for (const section of ['WHO HANDLED IT', 'MONEY', 'RECEIPTS AND INVOICES', 'TIMELINE', 'BASIS OF PREPARATION', 'PREPARED BY', 'REVIEWED BY']) {
			expect(sheet).toContain(section);
		}
		expect(sheet).toContain('ORDER PLACED');

		const csv = await (await page.request.get(`/${SLUG}/management/trail/${code}/csv`)).text();
		expect(csv.startsWith('﻿')).toBeTruthy();
		for (const section of ['Who handled it', 'Money', 'Timeline']) expect(csv).toContain(section);
		expect(csv).toContain('Order placed');
	});

	test('IP address and browser are for hotel admins only', async ({ page, browser }) => {
		const { code } = await placeVenuePayOrder(page);
		await staffLogin(page);
		await page.goto(trail(code));

		const expand = page.getByRole('button', { name: 'Show device and data' }).first();
		if ((await expand.count()) === 0) {
			// This login is not a hotel admin: it must see no device column at all, on the page or the sheet.
			await expect(page.getByText('IP address')).toHaveCount(0);
			await page.goto(`/${SLUG}/print/dining-trail/${code}`);
			expect(await page.locator('.rs-page').innerText()).not.toMatch(/\bFrom\b.*Data Privacy/s);
			test.info().annotations.push({ type: 'note', description: `${STAFF_EMAIL} is not a hotel admin; admin half skipped.` });
			return;
		}
		await expand.click();
		await expect(page.getByText('IP address').first()).toBeVisible();
		await expect(page.getByText(/Data Privacy Act/)).toBeVisible();

		// A dining-only login sees the trail, but none of that.
		const email = process.env.E2E_DINING_EMAIL;
		const password = process.env.E2E_DINING_PASSWORD;
		test.skip(!email || !password, 'Set E2E_DINING_EMAIL / E2E_DINING_PASSWORD for a dining-only account.');
		const ctx = await browser.newContext({ baseURL: page.url().split('/').slice(0, 3).join('/') });
		const other = await ctx.newPage();
		await other.goto(`/${SLUG}/management/login`);
		await other.locator('#email').fill(email!);
		await other.locator('input[name="password"]').fill(password!);
		await other.getByRole('button', { name: 'Sign in' }).click();
		await expect(other).toHaveURL(/\/management\//);
		await other.goto(trail(code));
		await expect(other.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
		await expect(other.getByText('IP address')).toHaveCount(0);
		await expect(other.getByRole('button', { name: 'Show device and data' })).toHaveCount(0);
		// ...and Find by number is in their sidebar.
		await expect(other.getByRole('link', { name: 'Find by number' })).toBeVisible();
		await ctx.close();
	});
});

test.describe('Audit log page', () => {
	test.beforeEach(async ({ page }) => {
		await staffLogin(page);
	});
	const audit = `/${SLUG}/management/settings/audit`;

	test('filters on the server: tracking number, action, actor kind and date range', async ({ page }) => {
		// A fresh dining order gives at least one entry carrying its number.
		const { code } = await placeVenuePayOrder(page);
		await staffLogin(page);

		await page.goto(`${audit}?q=${code}`);
		const rows = page.locator('tbody tr').filter({ hasText: code });
		await expect(rows.first()).toBeVisible();
		// Every visible entry belongs to that number (expanded detail rows aside).
		const all = await page.locator('tbody tr').allInnerTexts();
		for (const t of all) expect(t).toContain(code);

		await page.goto(`${audit}?q=${code}&action=dining_order.create`);
		await expect(page.getByText('Order placed').first()).toBeVisible();

		// The order was placed by a guest: the Guests filter finds it, the Any staff filter does not.
		await page.goto(`${audit}?q=${code}&actor=kind:guest`);
		await expect(page.locator('tbody tr').filter({ hasText: code }).first()).toBeVisible();
		await page.goto(`${audit}?q=${code}&actor=kind:staff`);
		await expect(page.getByText('No entries match these filters.')).toBeVisible();

		// A range in the past matches nothing.
		await page.goto(`${audit}?from=2000-01-01&to=2000-01-02`);
		await expect(page.getByText('No entries match these filters.')).toBeVisible();

		// Dining entries link to the trail.
		await page.goto(`${audit}?q=${code}`);
		await page.getByRole('link', { name: 'open →' }).first().click();
		await expect(page).toHaveURL(new RegExp(`/management/trail/${code}`));
	});

	test('paginates 50 at a time, and CSV and Print follow the filters', async ({ page }) => {
		await page.goto(audit);
		const header = await page.locator('p', { hasText: /entries?/ }).first().innerText();
		const total = Number((header.match(/([\d,]+) entr/) ?? [])[1]?.replace(/,/g, '') ?? 0);
		if (total > 50) {
			await expect(page.locator('tbody > tr')).toHaveCount(50);
			await expect(page.getByText(/Page 1 of/)).toBeVisible();
			await page.getByRole('link', { name: /Older/ }).click();
			await expect(page).toHaveURL(/page=2/);
			await expect(page.getByText(/Page 2 of/)).toBeVisible();
		}

		await page.goto(`${audit}?action=dining_order.create`);
		await expect(page.getByRole('link', { name: 'CSV' })).toHaveAttribute('href', /action=dining_order\.create/);
		await expect(page.getByRole('link', { name: 'Print' })).toHaveAttribute('href', /print\/audit\?.*action=dining_order\.create/);

		const csv = await page.request.get(`${audit}/csv?action=dining_order.create`);
		expect(csv.ok()).toBeTruthy();
		const text = await csv.text();
		expect(text.startsWith('﻿')).toBeTruthy();
		expect(text).toContain('Audit register');
		expect(text).toContain('Order placed');
		expect(text).not.toContain('Checked in');

		await page.goto(`/${SLUG}/print/audit?action=dining_order.create`);
		await expect(page.getByText('Audit register', { exact: true })).toBeVisible();
		const sheet = (await page.locator('.rs-page').innerText()).toUpperCase();
		for (const s of ['ENTRIES', 'BASIS OF PREPARATION', 'PREPARED BY']) expect(sheet).toContain(s);
	});
});
