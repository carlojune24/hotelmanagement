import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';

/**
 * Finance side of an SC/PWD booking: every cash movement says WHY it happened, and the reports show
 * money received, less refunds, then what was kept, with the discount and VAT removed explained.
 *
 * Reads existing data; the one step that moves money (refunding a credit) only runs when you ask for
 * it with E2E_REFUND=1, and needs an open cashier shift (or a hotel that does not require one).
 *   E2E_HOTEL_SLUG=mmhotel pnpm exec playwright test e2e/finance-sc-pwd.spec.ts --headed
 *   E2E_REFUND=1 ... to also refund the first credit it finds.
 *
 * Expected for a ₱2,126.88 room (VAT 12%), the figures should line up with:
 *   VAT removed ₱227.88 + 20% of ₱1,899.00 = ₱379.80  ->  reduction ₱607.68, charges ₱1,519.20
 *   paid in full, then SC/PWD, then refunded: received 2,126.88 - refunds 607.68 = net kept 1,519.20.
 *
 * Written, not yet run.
 */

const finance = `/${SLUG}/management/finance`;
const tx = `/${SLUG}/management/transactions`;
const RANGE = 'range=custom&from=2020-01-01&to=2099-12-31';
const REFUND = process.env.E2E_REFUND === '1';

test.describe('Finance · SC/PWD, downpayment and refund reasons', () => {
	test.beforeEach(async ({ page }) => {
		await staffLogin(page);
	});

	test('the cash ledger gives each movement a reason and links back to its booking', async ({ page }) => {
		await page.goto(`${finance}/cash`);
		await expect(page.getByRole('columnheader', { name: 'Reason' })).toBeVisible();
		const badges = page.locator('tbody tr td:nth-child(4) [data-slot="badge"]');
		test.skip((await badges.count()) === 0, 'No booking payments in the ledger yet.');
		const first = await badges.first().innerText();
		expect(first).toMatch(/Online downpayment|Online, paid in full|Partial payment|Balance at desk|Paid at desk|Refund|SC\/PWD credit refund/);
		await expect(page.locator('tbody tr a', { hasText: 'booking' }).first()).toHaveAttribute('href', /\/management\/transactions\//);
	});

	test('the daily sales report shows received, less refunds, and net kept', async ({ page }) => {
		await page.goto(`${finance}/reports/daily-sales`);
		for (const label of ['Gross received', 'Less: refunds paid out', 'Net income (kept)']) {
			await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
		}
	});

	test('revenue by source and cashflow show net of refunds, with SC/PWD as information', async ({ page }) => {
		await page.goto(`${finance}/reports/revenue-by-source?from=2020-01-01&to=2099-12-31`);
		await expect(page.getByText('Net income (kept)', { exact: true }).first()).toBeVisible();
		await page.goto(`${finance}/reports/cashflow?from=2020-01-01&to=2099-12-31`);
		await expect(page.getByText('Total out', { exact: true }).first()).toBeVisible();
	});

	test('the X-reading is received less refunds, and says SC/PWD is information only', async ({ page }) => {
		await page.goto(`${finance}/bir/readings`);
		await expect(page.getByText('Net sales (kept)')).toBeVisible();
		await expect(page.getByText('Less: refunds').first()).toBeVisible();
		// Present only on a day with an SC/PWD claim or credit.
		const note = page.getByText(/SC\/PWD, for information/);
		if (await note.count()) await expect(note).toContainText('not taken off again');
	});

	test('refunding an SC/PWD credit records a reason Finance can read (moves real money; opt-in)', async ({ page }) => {
		test.skip(!REFUND, 'Set E2E_REFUND=1 to refund the first SC/PWD credit it finds.');
		await page.goto(`${tx}?${RANGE}&scpwd=1&pay=credit`);
		const first = page.locator('tbody tr a.font-mono').first();
		test.skip((await first.count()) === 0, 'No SC/PWD booking with a credit.');
		await first.click();
		await page.getByRole('button', { name: 'Refund credit' }).click();
		await page.getByRole('dialog').getByRole('button', { name: /record|refund/i }).last().click();
		await expect(page.getByText('Refund recorded.')).toBeVisible();

		// The payment now says why, and the ledger tags it.
		await expect(page.getByText('Credit returned: the SC/PWD discount was applied after the guest paid')).toBeVisible();
		await page.goto(`${finance}/cash`);
		await expect(page.getByText('SC/PWD credit refund').first()).toBeVisible();
	});
});
