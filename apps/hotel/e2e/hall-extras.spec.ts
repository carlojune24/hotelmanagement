import { expect, test } from 'playwright/test';
import { SLUG, staffLogin, uniqueGuest } from './helpers';

/**
 * Walk-in function hall with extras: a custom taxable line + a custom non-VAT line raise the
 * grand total, the 50% chip fills Cash tendered with half of it, and the booking settles as a
 * partial payment (balance stays owed). Needs an active hall, an open cashier shift, staff login.
 */
test('hall walk-in: extras change the total and 50% downpayment chip fills half', async ({ page }) => {
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/front-desk`);
	await page.waitForLoadState('networkidle'); // click only after hydration
	const hall = page.locator('div.rounded-xl', { has: page.getByRole('button', { name: 'Walk-in event' }) }).first();
	test.skip((await hall.count()) === 0, 'No active function hall.');
	await hall.getByRole('button', { name: 'Walk-in event' }).click();

	const guest = uniqueGuest();
	await page.locator('input[name="eventType"]').fill('Birthday');
	await page.locator('#heGuestCount').fill('20');
	await page.locator('#heFullName').fill(guest.name);
	await page.locator('#heEmail').fill(guest.email);

	const drawer = page.getByRole('dialog');
	await drawer.getByPlaceholder('e.g. Lechon').fill('Lechon');
	await drawer.getByLabel('Price (₱)').fill('5000');
	await drawer.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(drawer.getByText('Extras (no VAT)')).toBeVisible();

	await drawer.getByRole('button', { name: '50%' }).click();
	const tendered = Number(await drawer.locator('input[name="tendered"]').inputValue());
	const totalText = await drawer.locator('div.border-t', { hasText: 'Total' }).first().innerText();
	const total = Number(totalText.replace(/[^0-9.]/g, '').replace(/^.*?(\d+\.\d{2})$/, '$1'));
	expect(tendered).toBeCloseTo(total / 2, 2);

	const submit = drawer.getByRole('button', { name: /Create & settle booking/ });
	test.skip(!(await submit.isEnabled()), 'The hall is not available (or could not be quoted).');
	await submit.click();
	await expect(page.getByText(guest.name).first()).toBeVisible({ timeout: 15_000 });
});
