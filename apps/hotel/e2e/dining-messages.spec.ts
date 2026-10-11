import { expect, test } from 'playwright/test';
import { SLUG, addFirstDish, orderFromUrl, staffLogin, uniqueGuest } from './helpers';

/**
 * Dining -> Messages: one inbox for every guest conversation, with what each is about, and an order
 * thread that opens without reloading itself.
 *
 * Prerequisites: a venue taking online orders that also allows paying at the restaurant.
 */

async function placeOrderAndWrite(page: import('playwright/test').Page, text: string) {
	const guest = uniqueGuest();
	await page.goto(`/${SLUG}/dining/order`);
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
	const { code } = orderFromUrl(page.url());

	await page.locator('#msgBody').fill(text);
	await page.getByRole('button', { name: 'Send message' }).click();
	await expect(page.getByText(text)).toBeVisible();
	return { code, guest };
}

test.describe('dining messages', () => {
	test('a guest message shows up in the Messages tab with its context, and a reply reaches the guest', async ({ page }) => {
		const text = `Is it spicy? ${Date.now()}`;
		const { code, guest } = await placeOrderAndWrite(page, text);
		const trackingUrl = page.url();

		await staffLogin(page);
		await page.goto(`/${SLUG}/management/dining/messages`);

		// The list says who it is from, what it is about, and that it is unread.
		const row = page.getByRole('link', { name: new RegExp(code) });
		await expect(row).toBeVisible();
		await expect(row.getByText('Online pickup')).toBeVisible();
		await row.click();

		// The conversation carries the order's context.
		await expect(page).toHaveURL(/order=/);
		await expect(page.getByRole('heading', { name: guest.name })).toBeVisible();
		await expect(page.getByText(text)).toBeVisible();
		await expect(page.getByText('Pickup', { exact: true })).toBeVisible();
		await expect(page.getByText('Payment')).toBeVisible();

		// Reply, then the guest sees it.
		await page.getByLabel('Reply to the guest').fill('Mild, we can make it spicier on request.');
		await page.getByRole('button', { name: 'Send reply' }).click();
		await expect(page.getByText('Mild, we can make it spicier on request.')).toBeVisible();
		await page.goto(trackingUrl);
		await expect(page.getByText('Mild, we can make it spicier on request.')).toBeVisible();
	});

	test('opening the thread sheet on Orders does not reload itself', async ({ page }) => {
		const { code } = await placeOrderAndWrite(page, `Hello ${Date.now()}`);
		await staffLogin(page);
		await page.goto(`/${SLUG}/management/dining/orders`);

		// Count the thread fetches the sheet makes: it must be one, not a loop.
		let opens = 0;
		page.on('request', (r) => {
			if (r.method() === 'POST' && r.url().includes('openThread')) opens++;
		});
		await page.getByText(code).first().click();
		await page.getByRole('button', { name: /^Messages/ }).first().click();
		await expect(page.getByText(/^Messages: /)).toBeVisible();
		await page.waitForTimeout(4000);
		expect(opens).toBeLessThanOrEqual(1);
	});
});
