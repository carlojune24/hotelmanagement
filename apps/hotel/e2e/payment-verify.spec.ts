import { expect, test } from 'playwright/test';
import { MANUAL, SLUG, addFirstDish, fillGuestDetails, payOnPaymongo, reserveAsGuest, staffLogin } from './helpers';

/**
 * Online payments confirm themselves: the app asks PayMongo directly, so a payment is picked up even when
 * PayMongo's webhook cannot reach the server (e.g. a dead ngrok tunnel in dev).
 *
 * Run the dev server WITHOUT a tunnel (or with the webhook subscription disabled), then:
 *   E2E_MANUAL=1 pnpm exec playwright test payment-verify --headed
 * and pay on the PayMongo test page when the browser stops, then press Resume.
 */

test.describe('payment verification without the webhook', () => {
	test('a paid dining order confirms on its own and shows the PayMongo payment ID', async ({ page }) => {
		test.skip(!MANUAL, 'Set E2E_MANUAL=1 and run with --headed to pay on the PayMongo test page yourself.');
		const guest = await reserveAsGuest(page);
		await addFirstDish(page);
		await fillGuestDetails(page, guest);
		await page.locator('input[name="payChoice"][value="online"]').check();
		await page.getByRole('button', { name: /^Pay .* now$/ }).click();

		await payOnPaymongo(page);

		await page.waitForURL(/\/dining\/order\/DN-/, { timeout: 60_000 });
		// No webhook arrives: the page's own check with PayMongo is what confirms it.
		await expect(page.getByText(/Payment reference/i)).toBeVisible({ timeout: 60_000 });
		await expect(page.getByText(/pay_[A-Za-z0-9]+/).first()).toBeVisible();

		// A refresh keeps the confirmed state and the reference (nothing is lost with the tab state).
		await page.reload();
		await expect(page.getByText(/pay_[A-Za-z0-9]+/).first()).toBeVisible();
	});

	test('while a payment is unconfirmed the page keeps waiting and never gives up', async ({ page }) => {
		test.skip(!MANUAL, 'Set E2E_MANUAL=1 and run with --headed; abandon the PayMongo page and return to the site.');
		const guest = await reserveAsGuest(page);
		await addFirstDish(page);
		await fillGuestDetails(page, guest);
		await page.locator('input[name="payChoice"][value="online"]').check();
		await page.getByRole('button', { name: /^Pay .* now$/ }).click();

		// On PayMongo: do NOT pay, navigate back to the order page by hand, then press Resume.
		await payOnPaymongo(page);
		await page.waitForURL(/\/dining\/order\/DN-/, { timeout: 60_000 });

		await expect(page.getByText(/Payment check code/i)).toBeVisible();
		await expect(page.getByText(/PC-[0-9A-F]{8}/)).toBeVisible();
		await expect(page.getByText(/gave up|could not confirm/i)).toHaveCount(0);
	});
});

test.describe('Finance → Reconciliation tab', () => {
	test('lists what needs attention and what the system settled on its own', async ({ page }) => {
		await staffLogin(page);
		await page.goto(`/${SLUG}/management/finance/reconciliation`);
		await expect(page.getByRole('heading', { name: 'Reconciliation' })).toBeVisible();
		await expect(page.getByText('Needs attention').first()).toBeVisible();
		await expect(page.getByText('Settled automatically').first()).toBeVisible();
		// The money trail re-checks itself on every visit: it must read as intact.
		await expect(page.getByText('Money trail verified')).toBeVisible();
		await expect(page.getByText('does not check out')).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'CSV' })).toBeVisible();
	});
});
