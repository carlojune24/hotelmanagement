import { expect, test } from 'playwright/test';
import { SLUG } from './helpers';

/**
 * Public storefront (2026-10 "boutique editorial" overhaul): hero booking bar, live rooms for the
 * chosen dates, room quick view, sticky bar, and responsiveness down to a phone.
 *
 * Prerequisites: a published hotel with at least one room type that has a rate plan and is free for
 * the next few weeks (set E2E_HOTEL_SLUG; the seed hotel is `mmhotel`).
 */

async function pickStay(page: import('playwright/test').Page, from = 2, to = 4) {
	await page.locator('.sf-bar .trigger').click();
	const days = page.locator('.sheet .day:not(:disabled)');
	test.skip((await days.count()) < to + 1, 'No bookable days in the next two months.');
	await days.nth(from).click();
	await days.nth(to).click();
}

test.describe('storefront', () => {
	test('the hero has the hotel name and a booking bar that stays disabled until dates are picked', async ({ page }) => {
		await page.goto(`/${SLUG}`);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		const submit = page.locator('.sf-bar .sf-bar-submit');
		await expect(submit).toBeDisabled();
		await pickStay(page);
		await expect(submit).toBeEnabled();
	});

	test('checking availability turns Rooms & Rates into live, priced options', async ({ page }) => {
		await page.goto(`/${SLUG}`);
		await pickStay(page);
		await page.locator('.sf-bar .sf-bar-submit').click();
		await expect(page).toHaveURL(/checkIn=\d{4}-\d{2}-\d{2}.*checkOut=/);
		await expect(page.locator('.sf-stay-note')).toBeVisible();
		// At least one room type shows a total and a Reserve button (or says it is unavailable).
		const reserve = page.getByRole('button', { name: 'Reserve' }).first();
		test.skip((await reserve.count()) === 0, 'Nothing is available for the picked dates.');
		await expect(page.locator('.sf-rate-total').first()).toContainText('₱');
	});

	test('Reserve adds the room to the cart and continues to guest details', async ({ page }) => {
		await page.goto(`/${SLUG}`);
		await pickStay(page);
		await page.locator('.sf-bar .sf-bar-submit').click();
		const reserve = page.getByRole('button', { name: 'Reserve' }).first();
		test.skip((await reserve.count()) === 0, 'Nothing is available for the picked dates.');
		await reserve.click();
		await expect(page).toHaveURL(new RegExp(`/${SLUG}/details`));
		await expect(page.getByText(/STEP 3 OF 4/).or(page.getByText('Guest Information').first())).toBeVisible();
	});

	test('quick view opens a sheet with the room, and closes again', async ({ page }) => {
		await page.goto(`/${SLUG}`);
		await page.getByRole('button', { name: 'Quick view' }).first().click();
		const sheet = page.getByRole('dialog');
		await expect(sheet.getByRole('heading', { level: 2 })).toBeVisible();
		await sheet.getByRole('button', { name: 'Close quick view' }).click();
		await expect(sheet).toBeHidden();
	});

	test('the booking bar follows the page once the hero is scrolled away', async ({ page }) => {
		await page.goto(`/${SLUG}`);
		await expect(page.locator('.sf-bar.is-stuck')).toHaveCount(0);
		await page.evaluate(() => document.getElementById('rooms')?.scrollIntoView());
		await expect(page.locator('.sf-bar.is-stuck')).toBeVisible();
	});

	test('on a phone: no horizontal scroll, the bar sits at the bottom and the menu opens', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`/${SLUG}`);
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
		expect(overflow).toBeLessThanOrEqual(1);
		await page.evaluate(() => document.getElementById('rooms')?.scrollIntoView());
		const box = await page.locator('.sf-bar.is-stuck').boundingBox();
		expect(box && box.y + box.height).toBeGreaterThan(800);
		await page.getByRole('button', { name: 'Open menu' }).click();
		await expect(page.getByRole('link', { name: 'Contact' }).last()).toBeVisible();
	});

	test('inner pages share the nav and footer', async ({ page }) => {
		for (const path of ['/contact', '/dining', '/meetings-events']) {
			await page.goto(`/${SLUG}${path}`);
			await expect(page.locator('.sf-nav')).toBeVisible();
			await expect(page.locator('.sf-foot')).toBeVisible();
		}
	});
});
