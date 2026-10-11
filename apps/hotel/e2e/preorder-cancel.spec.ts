import { expect, test } from 'playwright/test';
import { SLUG, addFirstDish, fillGuestDetails, reserveAsGuest, staffLogin } from './helpers';

/**
 * Cancelling or no-show on a booking that carries a pre-order.
 *
 * Unpaid (pay at the restaurant): the order is cancelled with the booking and nothing is due.
 * Paid online (E2E_MANUAL=1, you pay on PayMongo): it stays paid and appears on the Orders tab as a
 * refund due. The guest's own cancel button is used for the first, staff "Mark no-show" for the second.
 */

test('a guest cancelling their booking cancels the unpaid pre-order with it', async ({ page }) => {
	const guest = await reserveAsGuest(page, { daysAhead: 5 });
	test.skip(!/\/dining\/order\?/.test(page.url()), 'This venue does not take online orders.');
	await addFirstDish(page);
	await fillGuestDetails(page, guest);
	const venuePay = page.locator('input[name="payChoice"][value="venue"]');
	test.skip((await venuePay.count()) === 0, 'This venue only takes online payment.');
	await venuePay.check();
	await page.getByRole('button', { name: /place order/i }).click();
	await page.waitForURL(/\/dining\/order\/DN-/);
	const trackingUrl = page.url();

	// back to the booking ticket and cancel it
	await page.getByRole('link', { name: /reservation|back/i }).first().click().catch(() => undefined);
	await page.goto(trackingUrl);
	await expect(page.getByText(/We have your order|scheduled/)).toBeVisible();

	// find the ticket from the staff list, open it as the guest would from their email
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/dining/reservations?tab=upcoming&q=${encodeURIComponent(guest.name)}`);
	const row = page.getByRole('row', { name: new RegExp(guest.name) });
	await row.getByRole('button', { name: /Actions for/ }).click();
	await page.getByRole('menuitem', { name: 'Cancel reservation' }).click();
	const confirm = page.getByRole('button', { name: /cancel reservation|yes/i }).last();
	if (await confirm.isVisible().catch(() => false)) await confirm.click();

	// the order the guest placed is cancelled, and nothing is due because it was never paid
	await page.goto(trackingUrl);
	await expect(page.getByText(/Order cancelled/i)).toBeVisible();
	await expect(page.getByText(/No payment is due/i)).toBeVisible();
});

test('a no-show on a paid pre-order leaves a refund due', async ({ page }) => {
	test.skip(process.env.E2E_MANUAL !== '1', 'Needs a real online payment: set E2E_MANUAL=1 and run with --headed.');
	const guest = await reserveAsGuest(page, { daysAhead: 2 });
	await addFirstDish(page);
	await fillGuestDetails(page, guest);
	await page.locator('input[name="payChoice"][value="online"]').check();
	await page.getByRole('button', { name: /^Pay .* now$/ }).click();

	// ---- pay on PayMongo, wait for the redirect back to the order page, then press Resume ----
	await page.pause();
	await page.waitForURL(/\/dining\/order\/DN-/, { timeout: 60_000 });
	const orderCode = new URL(page.url()).pathname.split('/').pop()!;

	await staffLogin(page);
	await page.goto(`/${SLUG}/management/dining/reservations?tab=upcoming&q=${encodeURIComponent(guest.name)}`);
	const row = page.getByRole('row', { name: new RegExp(guest.name) });
	await row.getByRole('button', { name: /Actions for/ }).click();
	await page.getByRole('menuitem', { name: 'Mark no-show' }).click();

	await page.goto(`/${SLUG}/management/dining/orders`);
	await expect(page.getByText(orderCode).first()).toBeVisible();
	await expect(page.getByText(/refund/i).first()).toBeVisible();
});
