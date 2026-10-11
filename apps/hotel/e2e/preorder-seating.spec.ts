import { expect, test } from 'playwright/test';
import { SLUG, addFirstDish, fillGuestDetails, reserveAsGuest, staffLogin } from './helpers';

/**
 * Staff side: a reservation with a pre-order is seated and the order lands on that table's bill.
 *
 * The guest part runs first (pay at the restaurant, so no PayMongo is needed), then a manager signs in,
 * finds the booking on the Reservations tab, marks it seated and checks the Floor panel.
 */

test('seating a party puts its pre-order on the table bill', async ({ page }) => {
	// ---- guest: reserve and pre-order (pay at the restaurant) ----
	const guest = await reserveAsGuest(page, { daysAhead: 1 });
	test.skip(!/\/dining\/order\?/.test(page.url()), 'This venue does not take online orders.');
	await addFirstDish(page);
	await fillGuestDetails(page, guest);
	const venuePay = page.locator('input[name="payChoice"][value="venue"]');
	test.skip((await venuePay.count()) === 0, 'This venue only takes online payment.');
	await venuePay.check();
	await page.getByRole('button', { name: /place order/i }).click();
	await page.waitForURL(/\/dining\/order\/DN-/);
	const orderCode = new URL(page.url()).pathname.split('/').pop()!;

	// ---- staff: find the booking and seat it ----
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/dining/reservations?tab=upcoming&q=${encodeURIComponent(guest.name)}`);
	const row = page.getByRole('row', { name: new RegExp(guest.name) });
	await expect(row).toBeVisible();
	await expect(row.getByText('Pre-order')).toBeVisible(); // the chip on the Reservations tab
	await row.getByRole('button', { name: /Actions for/ }).click();
	await page.getByRole('menuitem', { name: 'Mark seated' }).click();
	await expect(page.getByText(/seated/i).first()).toBeVisible();

	// ---- the order is now on that table's bill ----
	await page.goto(`/${SLUG}/management/dining/orders`);
	await expect(page.getByText(orderCode).first()).toBeVisible();
	// the Floor shows it under the table's "Orders on this table"
	await page.goto(`/${SLUG}/management/dining/floor`);
	await expect(page.getByText(orderCode).first()).toBeVisible({ timeout: 15_000 });
});

test('a party cannot be seated onto a table that still has someone else’s open bill', async ({ page }) => {
	test.fixme(true, 'Seating guard is built; see preorder-edge-cases.spec.ts for the scripted steps.');
	await staffLogin(page);
});
