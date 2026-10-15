import { expect, test } from 'playwright/test';
import { SLUG } from './helpers';

/**
 * Public storefront: black & gold light/dark mode, the full-width About section and the uniform
 * gallery grid. The booking wizard must always stay light.
 *
 * Prerequisites: a published hotel with an `about` text and at least two gallery/room photos.
 */

test.describe('storefront theme', () => {
	test('follows the OS until the guest toggles, then remembers the choice', async ({ browser }) => {
		const context = await browser.newContext({ colorScheme: 'dark' });
		const page = await context.newPage();
		await page.goto(`/${SLUG}`);

		const root = page.locator('.woven-ledger').first();
		await expect(root).toHaveAttribute('data-mode', 'system');

		// Desktop toggle: OS is dark, so the first click goes to light and is stored.
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.locator('.sf-mode-btn').click();
		await expect(root).toHaveAttribute('data-mode', 'light');

		await page.reload();
		await expect(page.locator('.woven-ledger').first()).toHaveAttribute('data-mode', 'light');
		await context.close();
	});

	test('the booking wizard stays light even when the storefront is dark', async ({ browser }) => {
		const context = await browser.newContext();
		await context.addCookies([{ name: 'sf-mode', value: 'dark', url: process.env.E2E_BASE_URL ?? 'http://localhost:5175' }]);
		const page = await context.newPage();

		await page.goto(`/${SLUG}`);
		await expect(page.locator('.woven-ledger').first()).toHaveAttribute('data-mode', 'dark');

		await page.goto(`/${SLUG}/dates`);
		await expect(page.locator('.woven-ledger').first()).toHaveAttribute('data-mode', 'light');
		await context.close();
	});

	test('About is full width and the gallery tiles are all the same size', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`/${SLUG}`);

		await expect(page.locator('#about .sf-eyebrow')).toContainText('About us');
		const about = await page.locator('#about .sf-about').boundingBox();
		expect(about!.width).toBeGreaterThan(1440 - 2 * 100); // gutter only, not the 78rem column

		const tiles = page.locator('#gallery .sf-gallery button');
		const count = await tiles.count();
		expect(count).toBeGreaterThan(1);
		const first = await tiles.first().boundingBox();
		for (let i = 1; i < count; i++) {
			const box = await tiles.nth(i).boundingBox();
			expect(Math.abs(box!.width - first!.width)).toBeLessThan(1);
			expect(Math.abs(box!.height - first!.height)).toBeLessThan(1);
		}
	});
});
