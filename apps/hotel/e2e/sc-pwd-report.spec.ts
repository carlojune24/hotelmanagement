import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import { closeDb, hotelIdFor, sql } from './db';

/**
 * Finance → Reports → Senior / PWD discounts: the trail of every SC/PWD discount, hotel and dining,
 * with totals per day / week / month. Settles a table with one Senior and one PWD guest of three
 * diners, then checks the report shows that order with both guests, counts them by type, scopes by
 * side, links to the order's trail, and that its totals add up to the trail.
 *
 * Prerequisites: a dining venue with an available dish and a table, SC/PWD discount above 0 in
 * Dining settings, and a bank / e-wallet account for GCash (Finance settings).
 */

const mgmt = `/${SLUG}/management`;
const report = `${mgmt}/finance/reports/sc-pwd-discounts`;
let hotelId: string | null = null;

test.beforeAll(async () => {
	hotelId = await hotelIdFor(SLUG);
});
test.afterAll(closeDb);

test('the Senior / PWD report lists each discount, counts by type and side, and adds up', async ({ page }) => {
	test.skip(!hotelId, `No hotel with slug "${SLUG}". Set E2E_HOTEL_SLUG.`);
	await staffLogin(page);

	// A dine-in order on the first table.
	await page.goto(`${mgmt}/dining/orders`);
	const menu = page.locator('section[aria-label="Menu"]');
	await expect(async () => {
		await page.getByRole('button', { name: 'New order' }).click();
		await expect(menu).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 30_000 });
	const dish = menu.locator('li > button:not([disabled])').first();
	test.skip((await dish.count()) === 0, 'This venue has no available dish to sell.');
	await dish.click();
	const addToOrder = page.getByRole('button', { name: 'Add to order' });
	if (await addToOrder.isVisible().catch(() => false)) await addToOrder.click();
	const cart = page.locator('aside[aria-label="This order"]');
	await cart.getByText('Dine-in', { exact: true }).click();
	const tablePicker = cart.getByRole('combobox', { name: 'Table' });
	test.skip((await tablePicker.count()) === 0, 'This venue has no tables.');
	await tablePicker.click();
	await page.getByRole('option').nth(1).click();
	const before = new Date();
	await cart.getByRole('button', { name: 'Place order', exact: true }).click();
	await expect
		.poll(async () => (await sql`select id from dining_orders where hotel_id = ${hotelId} and check_id is not null and created_at >= ${before}`).length, { timeout: 20_000 })
		.toBeGreaterThan(0);
	const [order] = await sql<{ id: string; code: string; table_label: string }[]>`
		select id, code, table_label from dining_orders
		where hotel_id = ${hotelId} and check_id is not null and created_at >= ${before}
		order by created_at desc limit 1`;

	// Settle it: GCash, Senior + PWD of 3 diners.
	await page.goto(`${mgmt}/dining/orders`);
	const card = page.locator('div', { has: page.getByText(`Table ${order!.table_label}`, { exact: true }) })
		.filter({ has: page.getByRole('button', { name: 'Settle & close' }) })
		.last();
	await card.getByRole('button', { name: 'Settle & close' }).click();
	const dlg = page.getByRole('dialog');
	await dlg.getByRole('radio', { name: 'GCash' }).click();
	await dlg.getByRole('radio', { name: /^Senior \/ PWD/ }).click();
	await dlg.getByLabel('Name', { exact: true }).fill('Lola Report');
	await dlg.getByLabel('OSCA ID no.').fill('OSCA-R1');
	await dlg.getByRole('button', { name: 'Add another guest' }).click();
	await dlg.getByRole('group', { name: 'Guest 2 is a' }).getByRole('radio', { name: 'PWD' }).click();
	await dlg.locator('#claimantName1').fill('Juan Report');
	await dlg.getByLabel('PWD ID no.').fill('PWD-R2');
	await dlg.getByLabel('Diners in all').fill('3');
	await dlg.getByLabel('Reference no.').fill(`SCR-${Date.now().toString().slice(-6)}`);
	await dlg.getByRole('button', { name: /^Record ₱/ }).click();
	await expect
		.poll(async () => (await sql<{ s: string }[]>`select payment_status as s from dining_orders where id = ${order!.id}`)[0]?.s, { timeout: 20_000 })
		.toBe('paid');
	const [paid] = await sql<{ d: string; v: string; date: string }[]>`
		select discount_centavos as d, discount_vat_removed_centavos as v, business_date::text as date from dining_orders where id = ${order!.id}`;
	const off = Number(paid!.d) + Number(paid!.v);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	// This week, dining only: the order is in the trail with both guests and links to its trail page.
	await page.goto(`${report}?scope=dining`);
	await page.getByRole('link', { name: 'This week' }).click();
	const entry = page.locator('ol > li').filter({ hasText: order!.code });
	await expect(entry).toContainText('Lola Report');
	await expect(entry).toContainText('ID OSCA-R1');
	await expect(entry).toContainText('Juan Report');
	await expect(entry).toContainText('ID PWD-R2');
	await expect(entry.getByText('Senior', { exact: true })).toBeVisible();
	await expect(entry.getByText('PWD', { exact: true })).toBeVisible();
	await expect(entry).toContainText(peso(off));

	// Hotel only: the dining order is not there.
	await page.getByRole('link', { name: 'Hotel', exact: true }).click();
	await expect(page.locator('ol > li').filter({ hasText: order!.code })).toHaveCount(0);

	// Overall, by month: the big total equals the By period table's total, and the sum of the register.
	await page.goto(`${report}?from=${paid!.date}&to=${paid!.date}&group=month`);
	const toCentavos = (s: string | null) => Math.round(Number((s ?? '').replace(/[^0-9.-]/g, '')) * 100);
	const big = toCentavos(await page.getByRole('region', { name: 'Totals' }).locator('p').first().textContent());
	const footer = toCentavos(await page.locator('tfoot td').last().textContent());
	const entries = await page.locator('ol > li').evaluateAll((els) =>
		els.filter((e) => !e.textContent?.includes('Reversed')).map((e) => e.querySelector('div.text-right p')?.textContent ?? '')
	);
	expect(footer).toBe(big);
	expect(entries.reduce((s, e) => s + toCentavos(e), 0)).toBe(big);

	// The DN- link opens the order's own trail (payment, cash movement, receipt).
	await page.getByRole('link', { name: order!.code }).click();
	await expect(page).toHaveURL(new RegExp(`/management/trail/${order!.code}`));

	// CSV carries both tables.
	const csv = await (await page.request.get(`${report}/export?from=${paid!.date}&to=${paid!.date}`)).text();
	expect(csv).toContain('Every discount (the trail)');
	expect(csv).toContain(order!.code);
});
