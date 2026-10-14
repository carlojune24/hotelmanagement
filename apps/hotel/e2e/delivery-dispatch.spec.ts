import { expect, test } from 'playwright/test';
import { SLUG, addFirstDish, orderFromUrl, staffLogin, uniqueGuest } from './helpers';

/**
 * Delivery by the restaurant's own rider: the guest chooses Delivery, the kitchen makes it, staff send
 * it out with a rider, and the guest's order page says who is bringing it.
 *
 * Prerequisites: the venue has "Deliver online orders" switched on (Dining -> Venues & page -> Online
 * ordering) and allows paying at the restaurant. The kitchen step uses the Kitchen board's Start and
 * Ready buttons; adjust the button names if your board words them differently.
 */

test('a delivery order is sent out with a rider and the guest sees them', async ({ page }) => {
	const guest = uniqueGuest();

	// ---- guest: order, choose Delivery, pay at the restaurant ----
	await page.goto(`/${SLUG}/dining/order`);
	await addFirstDish(page);
	await page.getByRole('button', { name: /^Review order/ }).first().click();
	await page.getByRole('button', { name: 'Continue' }).click();

	const delivery = page.locator('input[name="fulfilmentChoice"][value="delivery"]');
	test.skip((await delivery.count()) === 0, 'This venue does not deliver. Switch it on in venue settings.');
	await expect(page.getByText('Delivered by our rider')).toBeVisible();
	await delivery.check();
	await page.getByLabel('Delivery address').fill('Unit 4, Palm St, Davao City');
	await page.locator('label.dining-slot').first().click();
	await page.getByRole('button', { name: 'Continue' }).click();

	await page.locator('#orName').fill(guest.name);
	await page.locator('#orPhone').fill(guest.phone);
	const venuePay = page.locator('input[name="payChoice"][value="venue"]');
	test.skip((await venuePay.count()) === 0, 'This venue only takes online payment.');
	await venuePay.check();
	await page.getByRole('button', { name: /place order/i }).click();
	await page.waitForURL(/\/dining\/order\/DN-/);
	const { code } = orderFromUrl(page.url());
	const trackingUrl = page.url();

	// ---- dining: accept it (online orders wait for Dining before the kitchen sees them) ----
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/dining/orders`);
	await page.getByLabel('Orders waiting for you').locator('li', { hasText: code }).getByRole('button', { name: 'Accept' }).click();

	// ---- kitchen: make it ----
	await page.goto(`/${SLUG}/management/kitchen`);
	const ticket = page.locator('article', { hasText: code }).first();
	await ticket.getByRole('button', { name: /^Start/ }).click();
	await ticket.getByRole('button', { name: /^Ready|Mark ready/ }).click();

	// ---- dining: send it out with a rider ----
	await page.goto(`/${SLUG}/management/dining/orders`);
	const card = page.locator('article', { hasText: code }).first();
	await expect(card.getByText('Delivery')).toBeVisible();
	await card.getByRole('button', { name: 'Send out for delivery' }).click();
	await page.getByLabel('Rider', { exact: true }).fill('Mario Rider');
	await page.getByLabel(/Rider's mobile/).fill('09171234567');
	await page.getByRole('button', { name: 'Send out' }).click();
	await expect(page.locator('article', { hasText: code }).getByRole('button', { name: 'Mark delivered' })).toBeVisible();

	// ---- guest: sees who is bringing it ----
	await page.goto(trackingUrl);
	await expect(page.getByText('On its way')).toBeVisible();
	await expect(page.getByText('Mario Rider').first()).toBeVisible();
});
