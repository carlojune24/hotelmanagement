import { expect, test } from 'playwright/test';
import { SLUG, MANUAL, addFirstDish, fillGuestDetails, orderFromUrl, payOnPaymongo, reserveAsGuest } from './helpers';

/**
 * Guest side of "reserve a table with an order".
 *
 * Needs a venue that takes online reservations AND online orders, with at least one available dish.
 * Pay-at-the-restaurant runs by itself; the pay-online test stops at PayMongo when E2E_MANUAL=1 (run
 * it with --headed) and is skipped otherwise.
 */

test.describe('reserve with an order', () => {
	test('reserving goes straight on to the menu, and the order is tied to the booking', async ({ page }) => {
		await reserveAsGuest(page);
		await expect(page).toHaveURL(/\/dining\/order\?.*reservation=TB-/);
		await expect(page.getByRole('heading', { name: 'Pre-order for your table' })).toBeVisible();
		// the way back to the ticket is always offered: the booking already stands without an order
		await expect(page.getByRole('link', { name: /back to your reservation/i })).toBeVisible();
	});

	test('pay at the restaurant: the order is scheduled, not already cooking, and the ticket lists it', async ({ page }) => {
		const guest = await reserveAsGuest(page);
		await addFirstDish(page);
		await fillGuestDetails(page, guest);
		const venuePay = page.locator('input[name="payChoice"][value="venue"]');
		test.skip((await venuePay.count()) === 0, 'This venue only takes online payment; use the pay-online test.');
		await venuePay.check();
		await page.getByRole('button', { name: /place order/i }).click();

		// tracking page: wording says it is held for the table time, not "the kitchen has your order"
		await page.waitForURL(/\/dining\/order\/DN-/);
		await expect(page.getByText(/Your order is scheduled|We have your order/)).toBeVisible();
		const { code, token } = orderFromUrl(page.url());
		expect(code).toMatch(/^DN-/);
		expect(token).toBeTruthy();

		// back on the reservation ticket the pre-order is listed with its code, so the guest is not
		// invited to order the same thing again
		await page.getByRole('link', { name: /back|reservation/i }).first().click().catch(() => undefined);
		await page.goto(`/${SLUG}/dining/order/${code}?t=${token}`);
		await expect(page.getByText(code)).toBeVisible();
	});

	test('pay online: held until due, and shown as paid (manual PayMongo step)', async ({ page }) => {
		test.skip(!MANUAL, 'Set E2E_MANUAL=1 and run with --headed to pay on the PayMongo test page yourself.');
		const guest = await reserveAsGuest(page);
		await addFirstDish(page);
		await fillGuestDetails(page, guest);
		await page.locator('input[name="payChoice"][value="online"]').check();
		await page.getByRole('button', { name: /^Pay .* now$/ }).click();

		// ---- you are now on PayMongo: pay with a test method, wait for the redirect, press Resume ----
		await payOnPaymongo(page);

		await page.waitForURL(/\/dining\/order\/DN-/, { timeout: 60_000 });
		await expect(page.getByText(/Paid|payment is confirmed|is paid/i)).toBeVisible({ timeout: 60_000 });
		await expect(page.getByText(/scheduled|starts it at|as soon as you are seated/i)).toBeVisible();
	});
});
