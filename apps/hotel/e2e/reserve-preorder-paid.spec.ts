import { expect, test } from 'playwright/test';
import { SLUG, futureDate, reserveAsGuest } from './helpers';
import { closeDb, sql } from './db';

/**
 * An online table reservation always comes with a pre-order paid in full online. There is no
 * "just the table" choice; the booking holds the table as `pending` until PayMongo confirms the
 * order, and the order page offers no "Pay at the restaurant".
 *
 * Prerequisites: the first venue takes online reservations and online orders, and PayMongo is
 * connected. The PayMongo step itself (reservation turns `confirmed`) is checked by hand.
 */

test.afterAll(closeDb);

test('reserving online goes straight to the menu, pending until paid, online payment only', async ({ page }) => {
	await page.goto(`/${SLUG}/dining/reserve?date=${futureDate(4)}&party=2`);
	test.skip(await page.getByText('Online reservations are not open right now').isVisible(), 'Online ordering or PayMongo is off for this venue.');

	await page.locator('label.dining-slot:has(input:not([disabled]))').first().click();
	await expect(page.locator('input[name="preorder"]')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Reserve and choose dishes' })).toBeVisible();

	await reserveAsGuest(page);
	await expect(page).toHaveURL(/\/dining\/order\?.*reservation=TB-/);

	const code = new URL(page.url()).searchParams.get('reservation')!;
	const [r] = await sql<{ status: string }[]>`select status from dining_reservations where code = ${code}`;
	expect(r?.status).toBe('pending');

	await expect(page.locator('input[name="payChoice"][value="venue"]')).toHaveCount(0);
	await expect(page.getByText('Pay now online')).toBeVisible();
});
