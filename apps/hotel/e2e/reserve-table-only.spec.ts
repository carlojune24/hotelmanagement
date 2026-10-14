import { expect, test } from 'playwright/test';
import { SLUG, reserveAsGuest, uniqueGuest, futureDate } from './helpers';

/**
 * Guest side of "reserve a table": the form offers "Just reserve the table" (default) or
 * "Reserve and pre-order". Needs a venue that takes online reservations; the choice only appears
 * when the venue also takes online orders.
 */

const reserveUrl = () => `/${SLUG}/dining/reserve?date=${futureDate(4)}&party=2`;

test.describe('reserve a table, with or without an order', () => {
	test('the form offers both choices, defaulting to just the table', async ({ page }) => {
		await page.goto(reserveUrl());
		await page.locator('label.dining-slot').first().click();
		const tableOnly = page.locator('input[name="preorder"][value="0"]');
		test.skip((await tableOnly.count()) === 0, 'This venue does not take online orders, so there is no choice to make.');
		await expect(tableOnly).toBeChecked();
		await expect(page.locator('input[name="preorder"][value="1"]')).not.toBeChecked();
		await expect(page.getByRole('button', { name: 'Reserve my table' })).toBeVisible();
		await page.locator('input[name="preorder"][value="1"]').check();
		await expect(page.getByRole('button', { name: 'Reserve and choose dishes' })).toBeVisible();
	});

	test('just the table: lands on the reservation ticket, no menu, and can still pre-order from it', async ({ page }) => {
		await reserveAsGuest(page, { withOrder: false });
		await expect(page).toHaveURL(/\/dining\/reserve\/TB-/);
		await expect(page.getByText(/TB-/).first()).toBeVisible();
		// the guest can still add an order later, if the venue and the time allow it
		const later = page.getByRole('link', { name: /Pre-order your meal/ });
		if (await later.count()) await expect(later).toBeVisible();
	});

	test('reserve and pre-order: still goes straight on to the menu', async ({ page }) => {
		await reserveAsGuest(page, { withOrder: true });
		await expect(page).toHaveURL(/\/dining\/(order\?.*reservation=TB-|reserve\/TB-)/);
	});

	test('no choice is needed when the guest submits without touching it', async ({ page }) => {
		const guest = uniqueGuest();
		await page.goto(reserveUrl());
		await page.locator('label.dining-slot').first().click();
		await page.locator('#rvName').fill(guest.name);
		await page.locator('#rvPhone').fill(guest.phone);
		await page.getByRole('button', { name: 'Reserve my table' }).click();
		await expect(page).toHaveURL(/\/dining\/reserve\/TB-/);
	});
});
