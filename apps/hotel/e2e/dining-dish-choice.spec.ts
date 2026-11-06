import { expect, test, type Page } from 'playwright/test';
import { SLUG, futureDate } from './helpers';

/**
 * Tapping a dish on the Dining page asks "Order online or Reserve a table?", and the dish is already
 * picked in whichever flow the guest chooses.
 *
 * Prerequisites: a venue with online ordering on (and, for the reserve test, table reservations with free
 * times). Each test skips itself when the data is not there. Run with E2E_HOTEL_SLUG=<your slug>.
 */
async function openDining(page: Page) {
	await page.goto(`/${SLUG}/dining`);
	await page.waitForLoadState('networkidle'); // click only after hydration
}
/** First tappable dish, optionally one with or without add-ons. */
function dish(page: Page, addons?: boolean) {
	const rows = page.locator('.sf-dish', { has: page.locator('.sf-dish-hit') });
	if (addons === undefined) return rows.first();
	const note = { has: page.locator('.sf-dish-note') };
	return (addons ? rows.filter(note) : rows.filter({ hasNot: page.locator('.sf-dish-note') })).first();
}

test('a plain dish → Order online lands in the cart once, even after a reload', async ({ page }) => {
	await openDining(page);
	const row = dish(page, false);
	test.skip((await row.count()) === 0, 'No orderable dish without add-ons.');
	const name = (await row.locator('.sf-dish-name').textContent())!.trim();

	await row.locator('.sf-dish-hit').click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText(name);
	const order = dialog.getByRole('link', { name: /Order online/ });
	test.skip((await order.count()) === 0, 'This venue takes reservations only.');
	await order.click();

	await expect(page).toHaveURL(/\/dining\/order/);
	await expect(page).not.toHaveURL(/dish=/); // dropped once applied
	// The cart's button carries the total: one of this dish, and still one after a reload.
	const review = page.getByRole('button', { name: /^Review order · ₱/ }).first();
	await expect(review).toBeVisible();
	const total = (await review.textContent())!.trim();
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('button', { name: /^Review order · ₱/ }).first()).toHaveText(total);
});

test('a dish with options → Order online opens its option picker', async ({ page }) => {
	await openDining(page);
	const row = dish(page, true);
	test.skip((await row.count()) === 0, 'No orderable dish with add-ons or sizes.');
	const name = (await row.locator('.sf-dish-name').textContent())!.trim();
	await row.locator('.sf-dish-hit').click();
	await expect(page.getByRole('dialog')).toContainText("You'll pick the size and add-ons next");
	const order = page.getByRole('dialog').getByRole('link', { name: /Order online/ });
	test.skip((await order.count()) === 0, 'This venue takes reservations only.');
	await order.click();
	await expect(page.locator('.order-dish', { hasText: name }).first().locator('.order-addons')).toBeVisible();
});

test('a dish → Reserve a table keeps it for the pre-order', async ({ page }) => {
	await openDining(page);
	const row = dish(page);
	const name = (await row.locator('.sf-dish-name').textContent())!.trim();
	await row.locator('.sf-dish-hit').click();
	const reserve = page.getByRole('dialog').getByRole('link', { name: /Reserve a table/ });
	test.skip((await reserve.count()) === 0, 'This venue does not take table reservations.');
	await reserve.click();
	await expect(page).toHaveURL(/\/dining\/reserve\?.*dish=/);
	await expect(page.locator('.reserve-dish-note')).toContainText(name);

	// Pick a day: the dish rides along through "Show times".
	await page.locator('#rvDate').fill(futureDate(5));
	await page.getByRole('button', { name: 'Show times' }).click();
	await expect(page).toHaveURL(/dish=/);
	await expect(page.locator('input[name="dish"]').last()).toHaveCount(1);
});

test('a sold-out dish cannot be tapped to order', async ({ page }) => {
	await openDining(page);
	const sold = page.locator('.sf-dish.is-sold-out').first();
	test.skip((await sold.count()) === 0, 'No dish is sold out today.');
	await expect(sold.locator('.sf-dish-hit')).toHaveCount(0);
});
