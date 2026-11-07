import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import { closeDb, hotelIdFor, sql } from './db';

/**
 * A GCash (or card / Maya) payment at the Dining register carries the wallet's reference no.
 * (the card slip's approval no.), like a room payment. "Record" stays disabled until it is typed,
 * it is saved on the order, and Find by number finds the order by it.
 *
 * Prerequisites: a dining venue with at least one available dish, and a bank / e-wallet account
 * in Finance settings for non-cash payments.
 */

test.afterAll(closeDb);

test('GCash payment at the register needs and keeps its reference no.', async ({ page }) => {
	const hotelId = await hotelIdFor(SLUG);
	test.skip(!hotelId, `No hotel with slug "${SLUG}". Set E2E_HOTEL_SLUG.`);
	const ref = `GC-E2E-${Date.now().toString().slice(-6)}`;

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
	await expect(pay.getByText('Take payment')).toBeVisible();
	await pay.getByRole('radio', { name: 'GCash' }).click();
	const record = pay.getByRole('button', { name: /^Record ₱/ });
	await expect(record).toBeDisabled();
	await pay.getByLabel('Reference no.').fill(ref);
	// Card asks for the approval no. instead, and the typed value carries over.
	await pay.getByRole('radio', { name: 'Card' }).click();
	await expect(pay.getByLabel('Approval no.')).toHaveValue(ref);
	await pay.getByRole('radio', { name: 'GCash' }).click();
	await expect(record).toBeEnabled();
	await record.click();

	await expect
		.poll(async () => (await sql<{ r: string | null }[]>`select payment_reference_no as r from dining_orders where hotel_id = ${hotelId} and payment_reference_no = ${ref}`)[0]?.r, { timeout: 20_000 })
		.toBe(ref);

	await page.goto(`/${SLUG}/management/lookup?q=${ref}`);
	await expect(page.getByText(`Payment reference ${ref}`)).toBeVisible();
});
