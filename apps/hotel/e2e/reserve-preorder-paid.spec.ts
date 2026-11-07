import { expect, test } from 'playwright/test';
import { SLUG, addFirstDish, futureDate, reserveAsGuest } from './helpers';
import { closeDb, sql } from './db';

/**
 * An online table reservation always comes with a pre-order paid in full online. There is no
 * "just the table" choice; the booking holds the table as `pending` until PayMongo confirms the
 * order, and the order page offers no "Pay at the restaurant". The guest's name, mobile and email
 * from the booking are already filled in on the pre-order's Details & pay step.
 *
 * Prerequisites: the first venue takes online reservations and PayMongo is connected. The
 * PayMongo step itself (reservation turns `confirmed`) is checked by hand.
 */

test.afterAll(closeDb);

test('reserving online goes straight to the menu, pending until paid, online payment only', async ({ page }) => {
	await page.goto(`/${SLUG}/dining/reserve?date=${futureDate(4)}&party=2`, { waitUntil: 'networkidle' });
	test.skip(await page.getByText('Online reservations are not open right now').isVisible(), 'PayMongo is off for this venue.');

	await page.locator('label.dining-slot:has(input:not([disabled]))').first().click();
	await expect(page.locator('input[name="preorder"]')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Reserve and choose dishes' })).toBeVisible();

	const guest = await reserveAsGuest(page);
	await expect(page).toHaveURL(/\/dining\/order\?.*reservation=TB-/);

	const code = new URL(page.url()).searchParams.get('reservation')!;
	const [r] = await sql<{ status: string }[]>`select status from dining_reservations where code = ${code}`;
	expect(r?.status).toBe('pending');

	// Order → Review → Details & pay (a pre-order has no pickup step).
	await page.waitForLoadState('networkidle');
	await addFirstDish(page);
	await page.getByRole('button', { name: /^Review order/ }).click();
	await page.getByRole('button', { name: 'Continue' }).click();

	await expect(page.locator('#orName')).toHaveValue(guest.name);
	await expect(page.locator('#orPhone')).toHaveValue(guest.phone);
	await expect(page.locator('#orEmail')).toHaveValue(guest.email);
	await expect(page.locator('input[name="payChoice"][value="venue"]')).toHaveCount(0);
	await expect(page.getByText('Pay now online')).toBeVisible();
	await expect(page.getByRole('button', { name: /^Pay ₱.* now$/ })).toBeEnabled();

	// Clearing the name disables Pay and says why.
	await page.locator('#orName').fill('');
	await expect(page.getByRole('button', { name: /^Pay ₱.* now$/ })).toBeDisabled();
	await expect(page.getByText('Enter your name and mobile number above to continue.')).toBeVisible();
});
