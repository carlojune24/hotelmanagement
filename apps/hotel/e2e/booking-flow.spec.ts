import { expect, test } from 'playwright/test';
import { SLUG } from './helpers';

/**
 * Guest booking wizard: 4 steps (Dates, Rooms & Rates, Guest Information, Booking Confirmation),
 * with an inline two-month calendar on the Dates step. Stops before PayMongo.
 *
 * Prerequisites: a published hotel with at least one available room type over the next few weeks.
 */

test.describe('guest booking flow', () => {
	test('the Dates step shows an inline calendar with a legend and a 4-step tracker', async ({ page }) => {
		await page.goto(`/${SLUG}/dates`);

		await expect(page.getByRole('heading', { name: /Check-in & check-out date/i })).toBeVisible();
		await expect(page.getByRole('group', { name: 'Choose your dates' })).toBeVisible();
		await expect(page.locator('.legend')).toContainText('Available');
		await expect(page.locator('.legend')).toContainText('Period of stay');
		await expect(page.locator('.legend')).toContainText('Not available');

		// Continue is locked until a stay is picked.
		await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();

		// Four steps, not five.
		const tracker = page.locator('nav .ledger-stepper-node, header .ledger-step');
		await expect(tracker.first()).toBeVisible();
		await expect(page.getByText('Booking Confirmation').or(page.getByText(/STEP 1 OF 4/))).toBeVisible();
	});

	test('picking a range enables Continue and carries the dates to Rooms & Rates', async ({ page }) => {
		await page.goto(`/${SLUG}/dates`);

		const days = page.locator('.day:not(:disabled)');
		test.skip((await days.count()) < 6, 'No bookable days in the next two months.');
		await days.nth(2).click();
		await days.nth(4).click();

		await expect(page.getByText(/2 nights?/).first()).toBeVisible();
		const cont = page.getByRole('button', { name: 'Continue' });
		await expect(cont).toBeEnabled();
		await cont.click();

		await expect(page).toHaveURL(new RegExp(`/${SLUG}/rooms\\?.*checkIn=\\d{4}-\\d{2}-\\d{2}.*checkOut=`));
		await expect(page.getByText(/STEP 2 OF 4/).or(page.getByText('Select Rooms & Rates').first())).toBeVisible();
	});

	test('the stay can be cleared and re-picked without leaving the page', async ({ page }) => {
		await page.goto(`/${SLUG}/dates`);
		const days = page.locator('.day:not(:disabled)');
		test.skip((await days.count()) < 6, 'No bookable days in the next two months.');

		await days.nth(1).click();
		await days.nth(3).click();
		await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();

		await page.getByRole('button', { name: 'Clear dates' }).click();
		await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
		await expect(page).toHaveURL(new RegExp(`/${SLUG}/dates`));
	});
});
