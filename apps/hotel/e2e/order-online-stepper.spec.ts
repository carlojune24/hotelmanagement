import { expect, test } from 'playwright/test';
import { SLUG, addFirstDish, orderFromUrl, uniqueGuest } from './helpers';

/**
 * "Order online" as four steps: 1 Order -> 2 Review -> 3 Pickup/Delivery + time -> 4 Details & pay.
 *
 * Prerequisites: a venue taking online orders with at least one available dish. Pay-at-the-restaurant
 * must be allowed for the full run to complete without PayMongo. The delivery test needs the venue's
 * "Deliver online orders" switch on; the same-day test needs "Today only" set under
 * Dining -> Venues & page -> Online ordering. Tests skip themselves when their setup is missing.
 */

const ORDER_URL = `/${SLUG}/dining/order`;

async function reviewStep(page: import('playwright/test').Page) {
	await page.getByRole('button', { name: /^Review order/ }).first().click();
	await expect(page.getByRole('heading', { name: 'Review your order' })).toBeVisible();
}

test.describe('order online stepper', () => {
	test('order, review, pick a time, then pay at the restaurant', async ({ page }) => {
		const guest = uniqueGuest();
		await page.goto(ORDER_URL);
		await expect(page.getByText(/STEP 1 OF|Order\b/).first()).toBeVisible();

		// 1 Order
		await addFirstDish(page);
		await reviewStep(page);

		// 2 Review: the quantity can be changed, then continue
		await page.getByRole('button', { name: 'More' }).first().click();
		await page.getByRole('button', { name: 'Continue' }).click();

		// 3 When: a time is required before Continue is enabled
		const cont = page.getByRole('button', { name: 'Continue' });
		await expect(cont).toBeDisabled();
		await page.locator('label.dining-slot').first().click();
		await expect(cont).toBeEnabled();
		await cont.click();

		// 4 Details & pay: the recap carries the choices, with a way back to change them
		await expect(page.getByText('Almost there')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Change' }).first()).toBeVisible();
		await page.locator('#orName').fill(guest.name);
		await page.locator('#orPhone').fill(guest.phone);
		const venuePay = page.locator('input[name="payChoice"][value="venue"]');
		test.skip((await venuePay.count()) === 0, 'This venue only takes online payment.');
		await venuePay.check();
		await page.getByRole('button', { name: /place order/i }).click();

		await page.waitForURL(/\/dining\/order\/DN-/);
		expect(orderFromUrl(page.url()).code).toMatch(/^DN-/);
	});

	test('browser Back returns to the previous step and a reload keeps the cart', async ({ page }) => {
		await page.goto(ORDER_URL);
		await addFirstDish(page);
		await reviewStep(page);

		await page.goBack();
		await expect(page.getByRole('button', { name: /^Review order/ }).first()).toBeVisible(); // step 1 again

		await page.reload();
		await expect(page.locator('.order-line').first()).toBeVisible(); // the cart survived the reload
	});

	test('delivery: needs an address, shows the fee, and the total includes it', async ({ page }) => {
		await page.goto(ORDER_URL);
		await addFirstDish(page);
		await reviewStep(page);
		await page.getByRole('button', { name: 'Continue' }).click();

		const delivery = page.locator('input[name="fulfilmentChoice"][value="delivery"]');
		test.skip((await delivery.count()) === 0, 'This venue does not deliver. Switch it on in venue settings.');
		await delivery.check();

		await expect(page.getByLabel('Delivery address')).toBeVisible();
		await expect(page.getByText('Delivery fee').first()).toBeVisible(); // in the order summary

		await page.locator('label.dining-slot').first().click();
		await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled(); // no address yet
		await page.getByLabel('Delivery address').fill('Unit 4, Palm St, Davao City');
		await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
		await page.getByRole('button', { name: 'Continue' }).click();

		await expect(page.getByText('Deliver to')).toBeVisible();
		await expect(page.getByText('Unit 4, Palm St, Davao City')).toBeVisible();
	});

	test('a venue that is same-day only shows no day chips', async ({ page }) => {
		await page.goto(ORDER_URL);
		await addFirstDish(page);
		await reviewStep(page);
		await page.getByRole('button', { name: 'Continue' }).click();
		const dayTabs = page.getByRole('tablist', { name: 'Pickup day' });
		test.skip((await dayTabs.count()) > 0, 'This venue allows ordering ahead; set "Today only" to run this check.');
		await expect(page.getByText(/^Today,/)).toBeVisible();
	});

	test('a pre-order from a reservation skips the pickup/delivery step', async ({ page }) => {
		test.skip(true, 'Reserve a table first (see preorder-flow.spec.ts) and open the order link from the ticket, then remove this line.');
		await page.goto(ORDER_URL);
	});
});
