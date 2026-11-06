import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';

/**
 * "Show all items" on the staff Menu tab lists dishes taken off with "Remove from menu", and
 * Restore puts one back. Each run adds its own uniquely named dish on the default venue.
 */

const DISH = `E2E Removed ${Date.now().toString(36)}`;

test('a removed dish shows under Show all items and can be restored', async ({ page }) => {
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/dining/menu`);

	await page.getByRole('button', { name: 'New item' }).click();
	await page.locator('#itemName').fill(DISH);
	await page.locator('#itemPrice').fill('99');
	await page.getByRole('button', { name: 'Add item' }).click();
	const list = page.getByRole('region', { name: 'Menu items' });
	await expect(list.getByText(DISH)).toBeVisible();

	// Remove it: gone from the list
	await page.getByRole('button', { name: `Edit ${DISH}` }).click();
	await page.getByRole('button', { name: 'Remove from menu' }).click();
	await expect(list.getByText(DISH)).toHaveCount(0);

	// Show all items: listed as removed
	await page.getByRole('button', { name: /Show all items/ }).click();
	const removed = page.getByRole('list', { name: 'Removed dishes' });
	const row = removed.getByRole('listitem').filter({ hasText: DISH });
	await expect(row).toBeVisible();

	// Restore: back on the menu
	await row.getByRole('button', { name: 'Restore' }).click();
	await expect(page.getByText(`Put "${DISH}" back on the menu.`)).toBeVisible();
	await expect(page.getByRole('button', { name: `Edit ${DISH}` })).toBeVisible();
});
