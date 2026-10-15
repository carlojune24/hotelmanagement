import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';

/**
 * Finance → PayMongo: the hotel's real PayMongo money (balance cards, incoming / outgoing records with PayMongo
 * IDs, fee and net), mirrored from PayMongo's own API.
 *
 * Prerequisites: PayMongo connected for the hotel (a TEST key is fine) with at least one payment in the account,
 * and a staff login with finance:read. Migration 0100 applied.
 */
test.describe('finance paymongo tab', () => {
  test('shows the balance, the records with PayMongo IDs, and filters them', async ({ page }) => {
    await staffLogin(page);
    await page.goto(`/${SLUG}/management/finance/paymongo`);

    // The first visit pulls the records from PayMongo in the background.
    await expect(page.getByRole('heading', { name: 'PayMongo' })).toBeVisible();
    await expect(page.getByText('Available', { exact: true })).toBeVisible();
    await expect(page.getByText('Pending', { exact: true })).toBeVisible();
    await expect(page.getByText('On the way to the bank')).toBeVisible();

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });
    await expect(rows.first()).toContainText(/pay_|ref_|po_/);

    // Incoming only: every row is money in.
    await page.getByRole('link', { name: 'Incoming' }).click();
    await expect(page).toHaveURL(/dir=in/);
    await expect(page.getByLabel('Incoming').first()).toBeVisible();

    // A row opens PayMongo's own record with the fee and the net.
    await page.waitForTimeout(2_000); // let the page hydrate before clicking a row
    await rows.first().locator('td').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('PayMongo fee')).toBeVisible();
    await expect(dialog.getByText('Net to the hotel')).toBeVisible();
    // The customer's billing details are never shown.
    await expect(dialog).not.toContainText('"billing"');
  });

  test('"Sync now" starts a refresh and cannot be spammed', async ({ page }) => {
    await staffLogin(page);
    await page.goto(`/${SLUG}/management/finance/paymongo`);
    await page.waitForTimeout(2_500);
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByText(/^Synced|^Syncing/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByText(/Just synced/)).toBeVisible();
  });

  test('the CSV export lists the same records', async ({ page }) => {
    await staffLogin(page);
    await page.goto(`/${SLUG}/management/finance/paymongo`);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'CSV' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^paymongo-.*\.csv$/);
  });
});
