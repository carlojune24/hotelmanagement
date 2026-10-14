import { expect, test, type Page } from 'playwright/test';
import { SLUG, addFirstDish, orderFromUrl, staffLogin, uniqueGuest } from './helpers';

/**
 * Online pickup / delivery orders wait for Dining to accept them; only then does the kitchen see them,
 * clearly marked as online.
 *
 * Prerequisites: a venue taking online orders that also allows paying at the restaurant. The delivery
 * test needs "Deliver online orders" switched on. Tests skip themselves when their setup is missing.
 */

const ORDER_URL = `/${SLUG}/dining/order`;

/** Places a pay-at-the-restaurant order as a guest and returns its code and tracking page. */
async function placeVenuePayOrder(page: Page, opts: { delivery?: boolean } = {}) {
	const guest = uniqueGuest();
	await page.goto(ORDER_URL);
	await addFirstDish(page);
	await page.getByRole('button', { name: /^Review order/ }).first().click();
	await page.getByRole('button', { name: 'Continue' }).click();

	if (opts.delivery) {
		const delivery = page.locator('input[name="fulfilmentChoice"][value="delivery"]');
		test.skip((await delivery.count()) === 0, 'This venue does not deliver. Switch it on in venue settings.');
		await delivery.check();
		await page.getByLabel('Delivery address').fill('Unit 4, Palm St, Davao City');
	}
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

test.describe('online order acceptance', () => {
	test('a pickup order waits for Dining, then reaches the kitchen marked Online', async ({ page }) => {
		const { code, trackingUrl } = await placeVenuePayOrder(page);

		// Guest: placed, but not confirmed yet.
		await expect(page.getByText('Waiting for the restaurant to confirm')).toBeVisible();

		// Kitchen: not on the board yet.
		await staffLogin(page);
		await page.goto(`/${SLUG}/management/kitchen`);
		await expect(page.locator('article', { hasText: code })).toHaveCount(0);

		// Dining: waiting, with where it came from and how it is paid.
		await page.goto(`/${SLUG}/management/dining/orders`);
		const waiting = page.getByLabel('Orders waiting for you');
		const row = waiting.locator('li', { hasText: code });
		await expect(row.getByText('Online')).toBeVisible();
		await expect(row.getByText(/Pickup/)).toBeVisible();
		await expect(row.getByText('Pay at the restaurant')).toBeVisible();
		await row.getByRole('button', { name: 'Accept' }).click();
		await expect(waiting.locator('li', { hasText: code })).toHaveCount(0);

		// Kitchen: now there, and unmistakably online.
		await page.goto(`/${SLUG}/management/kitchen`);
		const ticket = page.locator('article', { hasText: code }).first();
		await expect(ticket).toBeVisible();
		await expect(ticket.getByText('Online', { exact: true })).toBeVisible();
		await expect(ticket.getByText(/^Pickup/)).toBeVisible();
		await expect(ticket.getByText('Pay at counter')).toBeVisible();

		// Guest: the page moved on.
		await page.goto(trackingUrl);
		await expect(page.getByText('We have your order')).toBeVisible();
	});

	test('declining tells the guest why and never reaches the kitchen', async ({ page }) => {
		const { code, trackingUrl } = await placeVenuePayOrder(page, { delivery: true });

		await staffLogin(page);
		await page.goto(`/${SLUG}/management/dining/orders`);
		const row = page.getByLabel('Orders waiting for you').locator('li', { hasText: code });
		await expect(row.getByText('Delivery')).toBeVisible();
		await row.getByRole('button', { name: 'Decline' }).click();
		await page.getByLabel('Reason').fill('Sorry, we are out of riders today');
		await page.getByRole('button', { name: 'Decline order' }).click();

		await page.goto(`/${SLUG}/management/kitchen`);
		await expect(page.locator('article', { hasText: code })).toHaveCount(0);

		await page.goto(trackingUrl);
		await expect(page.getByText('Order cancelled')).toBeVisible();
		await expect(page.getByText('out of riders today')).toBeVisible();
	});

	test('a guest can cancel an unaccepted, unpaid order themselves', async ({ page }) => {
		await placeVenuePayOrder(page);
		await page.getByRole('button', { name: /cancel order/i }).first().click();
		const confirm = page.getByRole('button', { name: /yes, cancel|confirm/i });
		if (await confirm.count()) await confirm.first().click();
		await expect(page.getByText('Order cancelled')).toBeVisible();
	});
});
