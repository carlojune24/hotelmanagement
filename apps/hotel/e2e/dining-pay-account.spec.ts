import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import { closeDb, hotelIdFor, sql } from './db';

/**
 * Finance settings → "Dining payment accounts": a GCash payment at the Dining register says which
 * account it posts to, and lands in dining's own GCash account, not the hotel's.
 *
 * Prerequisites: a dining venue with an available dish, and at least one bank / e-wallet account.
 * The test points Dining GCash at one for its run and puts the setting back after.
 */

let hotelId: string | null = null;
let saved: unknown = null;

test.afterAll(async () => {
	if (hotelId && saved !== null) await sql`update finance_settings set dining_method_account_ids = ${sql.json(saved as never)} where hotel_id = ${hotelId}`;
	await closeDb();
});

test('dining GCash posts to the Dining GCash account and the dialog names it', async ({ page }) => {
	hotelId = await hotelIdFor(SLUG);
	test.skip(!hotelId, `No hotel with slug "${SLUG}". Set E2E_HOTEL_SLUG.`);
	const [acct] = await sql<{ id: string; name: string }[]>`
		select id, name from cash_accounts
		where hotel_id = ${hotelId} and is_active and kind in ('e_wallet', 'bank') order by kind desc, name limit 1`;
	test.skip(!acct, 'No bank / e-wallet account to point Dining GCash at.');
	const [fs] = await sql<{ m: unknown }[]>`select dining_method_account_ids as m from finance_settings where hotel_id = ${hotelId}`;
	test.skip(!fs, 'Finance settings not set up for this hotel.');
	saved = fs!.m;
	await sql`update finance_settings set dining_method_account_ids = ${sql.json({ ...(saved as object), gcash: acct!.id })} where hotel_id = ${hotelId}`;

	const ref = `GA-E2E-${Date.now().toString().slice(-6)}`;
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/dining/orders`);
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
	await cart.getByText('Takeaway', { exact: true }).click();
	await cart.getByRole('button', { name: 'Place & pay' }).click();

	const pay = page.getByRole('dialog');
	await pay.getByRole('radio', { name: 'GCash' }).click();
	await expect(pay.locator('[data-pay-account]')).toHaveText(acct!.name);
	await pay.getByLabel('Reference no.').fill(ref);
	await pay.getByRole('button', { name: /^Record ₱/ }).click();

	await expect
		.poll(async () => (await sql<{ a: string | null }[]>`select cash_account_id as a from dining_orders where hotel_id = ${hotelId} and payment_reference_no = ${ref}`)[0]?.a, { timeout: 20_000 })
		.toBe(acct!.id);
});
