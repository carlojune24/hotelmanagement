import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import { closeDb, hotelIdFor, sql } from './db';

/**
 * The hotel admin / manager can void a food order from the Kitchen board with a reason. A paid
 * order has its payment reversed first, so the order ends cancelled and unpaid.
 *
 * Prerequisites: the E2E staff account has `dining:void` (Hotel Admin does), a dining venue with an
 * available dish, and a bank / e-wallet account in Finance settings for GCash.
 */

test.afterAll(closeDb);

test('void a paid order from the Kitchen board, with a reason', async ({ page }) => {
	const hotelId = await hotelIdFor(SLUG);
	test.skip(!hotelId, `No hotel with slug "${SLUG}". Set E2E_HOTEL_SLUG.`);

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
	await pay.getByLabel('Reference no.').fill(`GC-VOID-${Date.now().toString().slice(-6)}`);
	await pay.getByRole('button', { name: /^Record ₱/ }).click();
	let code = '';
	await expect
		.poll(async () => {
			const [o] = await sql<{ code: string; payment_status: string }[]>`select code, payment_status from dining_orders where hotel_id = ${hotelId} order by created_at desc limit 1`;
			code = o?.code ?? '';
			return o?.payment_status;
		}, { timeout: 20_000 })
		.toBe('paid');

	await page.goto(`/${SLUG}/management/kitchen?view=tickets`, { waitUntil: 'networkidle' });
	const ticket = page.locator('article', { hasText: code });
	await ticket.getByRole('button', { name: 'Void order' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByText(`Void order ${code}?`)).toBeVisible();
	await expect(dialog.getByText('Its payment is reversed')).toBeVisible();
	const confirm = dialog.getByRole('button', { name: 'Void order' });
	await expect(confirm).toBeDisabled();
	await dialog.getByLabel('Why is it being voided?').fill('E2E: wrong order keyed in');
	await confirm.click();
	await expect(dialog).toBeHidden();
	await expect(page.locator('article', { hasText: code })).toHaveCount(0);

	const [row] = await sql<{ status: string; payment_status: string; cancel_reason: string }[]>`
		select status, payment_status, cancel_reason from dining_orders where hotel_id = ${hotelId} and code = ${code}`;
	expect(row).toMatchObject({ status: 'cancelled', payment_status: 'unpaid', cancel_reason: 'E2E: wrong order keyed in' });
});
