import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';

/**
 * Booking transactions: how a booking was made (Walk-in / Online), how far it is paid, and SC/PWD.
 * Reads the hotel's existing bookings, so it needs a few in the date range below, ideally one
 * walk-in with an SC/PWD discount applied after payment (a credit). Tests skip, not fail, when the
 * data they need is not there. Run with the slug of the hotel you tested on, e.g.
 *   E2E_HOTEL_SLUG=mmhotel pnpm exec playwright test e2e/booking-transactions.spec.ts --headed
 *
 * Written, not yet run.
 */

const list = `/${SLUG}/management/transactions`;
// A wide custom range so older test bookings are included.
const RANGE = 'range=custom&from=2020-01-01&to=2099-12-31';

test.describe('Booking transactions · source, payment and SC/PWD', () => {
	test.beforeEach(async ({ page }) => {
		await staffLogin(page);
	});

	test('the list shows Booked and Payment columns, the filters, and the tip notes', async ({ page }) => {
		await page.goto(`${list}?${RANGE}`);
		await expect(page.getByRole('columnheader', { name: 'Booked' })).toBeVisible();
		await expect(page.getByRole('columnheader', { name: 'Payment' })).toBeVisible();
		for (const name of ['Walk-in', 'Online', 'Paid in full', 'Downpayment', 'Credit owed', 'SC/PWD only']) {
			await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
		}
		// The tip notes are folded away until opened.
		const tips = page.locator('details', { hasText: 'How to read this list' });
		await tips.locator('summary').click();
		await expect(tips.getByText('VAT-exempt')).toBeVisible();
		await expect(tips.getByText('Credit owed.')).toBeVisible();
	});

	test('the Walk-in and Online filters narrow the list and the totals follow', async ({ page }) => {
		await page.goto(`${list}?${RANGE}`);
		const total = await page.locator('tbody tr').count();
		test.skip(total === 0, 'No bookings in range.');

		await page.getByRole('link', { name: 'Walk-in', exact: true }).click();
		await expect(page).toHaveURL(/source=walkin/);
		for (const badge of await page.locator('tbody tr td:nth-child(6)').allInnerTexts()) expect(badge.trim()).toBe('Walk-in');

		await page.getByRole('link', { name: 'Online', exact: true }).click();
		await expect(page).toHaveURL(/source=online/);
		for (const badge of await page.locator('tbody tr td:nth-child(6)').allInnerTexts()) expect(badge.trim()).toBe('Online');

		// Print and CSV carry the same filters as the page.
		await expect(page.getByRole('link', { name: 'CSV' })).toHaveAttribute('href', /source=online/);
		await expect(page.getByRole('link', { name: 'Print' }).first()).toHaveAttribute('href', /source=online/);
	});

	test('SC/PWD only shows only discounted bookings, and Credit owed only those with a credit', async ({ page }) => {
		await page.goto(`${list}?${RANGE}&scpwd=1`);
		const rows = page.locator('tbody tr');
		test.skip((await rows.count()) === 0, 'No SC/PWD bookings in range.');
		for (const cell of await page.locator('tbody tr td:nth-child(7)').allInnerTexts()) expect(cell).toContain('SC/PWD');

		await page.goto(`${list}?${RANGE}&pay=credit`);
		for (const cell of await page.locator('tbody tr td:nth-child(7)').allInnerTexts()) expect(cell).toContain('Credit owed');
	});

	test('a booking with an SC/PWD discount explains the discount on its page', async ({ page }) => {
		await page.goto(`${list}?${RANGE}&scpwd=1`);
		const first = page.locator('tbody tr a.font-mono').first();
		test.skip((await first.count()) === 0, 'No SC/PWD bookings in range.');
		await first.click();

		await expect(page.getByText('How this is worked out')).toBeVisible();
		await expect(page.getByText(/VAT removed ₱[\d,.]+ \+ 20% of the VAT-exclusive price/)).toBeVisible();
		await expect(page.getByText(/SC\/PWD · /).first()).toBeVisible();
	});

	test('a credit left by an SC/PWD discount applied after payment says why, and pre-fills the refund reason', async ({ page }) => {
		await page.goto(`${list}?${RANGE}&scpwd=1&pay=credit`);
		const first = page.locator('tbody tr a.font-mono').first();
		test.skip((await first.count()) === 0, 'No SC/PWD booking with a credit in range.');
		await first.click();

		await expect(page.getByText('Why there is a credit:')).toBeVisible();
		await page.getByRole('button', { name: 'Refund credit' }).click();
		await expect(page.getByLabel('Reason')).toHaveValue('SC/PWD discount applied after payment');
		// Closed without refunding: this test never moves money.
		await page.keyboard.press('Escape');
	});
});
