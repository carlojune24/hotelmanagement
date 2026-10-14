import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';

/**
 * Front desk: checking a guest out (early or on time) while the hotel still owes them a credit asks
 * first, says how much, and offers to refund it there and then.
 *
 * Needs an IN-HOUSE room whose folio is in credit, with no security deposit still held (a held
 * deposit disables the Check out button). One easy way to get it:
 *   1. Walk-in, pay the full price in cash, check in.
 *   2. Open the room, Guest ID & SC/PWD discount, apply a Senior Citizen discount  -> credit appears.
 *   3. Settle the security deposit if one is held.
 * Then run (use the slug of the hotel you tested on):
 *   E2E_HOTEL_SLUG=mmhotel pnpm exec playwright test e2e/checkout-refund-confirm.spec.ts --headed
 * The test only OPENS the dialog and closes it again; it never refunds or checks anyone out unless
 * you set E2E_CONFIRM=1, which refunds and checks out the first such guest.
 *
 * Written, not yet run.
 */

const CONFIRM = process.env.E2E_CONFIRM === '1';

test.describe('front desk · check out with a credit owed', () => {
	test.beforeEach(async ({ page }) => {
		await staffLogin(page);
		await page.goto(`/${SLUG}/management/front-desk`);
	});

	test('Check out / Check out early opens a refund confirmation with the amount', async ({ page }) => {
		// Open the first occupied or departing room tile.
		const tile = page.locator('button', { hasText: /Checked in|Departing|Occupied/i }).first();
		test.skip((await tile.count()) === 0, 'No in-house room to try.');
		await tile.click();

		const checkout = page.getByRole('button', { name: /^Check out( early)?$/ });
		await expect(checkout).toBeVisible();
		test.skip(await checkout.isDisabled(), 'Check out is blocked (a deposit is held or a balance is owed).');

		const credit = page.getByRole('button', { name: /Refund credit \(₱/ });
		test.skip((await credit.count()) === 0, 'This room has no credit owed, so check out goes straight through.');

		await checkout.click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByText('Refund the guest before checking out')).toBeVisible();
		await expect(dialog.getByText(/There will be a refund to the guest amounting to/)).toBeVisible();
		await expect(dialog.getByText(/₱[\d,]+\.\d{2}/).first()).toBeVisible();
		await expect(dialog.getByText('Please refund the credit we owe to the guest.', { exact: false })).toBeVisible();

		// Checking out without refunding needs an explicit acknowledgement.
		const without = dialog.getByRole('button', { name: 'Check out without refunding' });
		await expect(without).toBeDisabled();
		await dialog.getByRole('checkbox').check();
		await expect(without).toBeEnabled();

		await page.keyboard.press('Escape'); // nothing is refunded or checked out by this test
		await expect(dialog).toBeHidden();
	});

	test('refund in the dialog, then check out (moves real money; opt-in)', async ({ page }) => {
		test.skip(!CONFIRM, 'Set E2E_CONFIRM=1 to refund the credit and check the guest out.');
		const tile = page.locator('button', { hasText: /Checked in|Departing|Occupied/i }).first();
		test.skip((await tile.count()) === 0, 'No in-house room to try.');
		await tile.click();
		const checkout = page.getByRole('button', { name: /^Check out( early)?$/ });
		test.skip(await checkout.isDisabled(), 'Check out is blocked.');
		await checkout.click();

		const dialog = page.getByRole('dialog');
		await dialog.getByRole('button', { name: /refund/i }).first().click();
		await expect(dialog.getByText('Credit refunded')).toBeVisible({ timeout: 15_000 });
		await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
		await expect(page.getByText('Guest checked out.')).toBeVisible();
	});
});
