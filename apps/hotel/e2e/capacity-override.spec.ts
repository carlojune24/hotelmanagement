import { expect, test } from 'playwright/test';
import { SLUG, futureDate, staffLogin } from './helpers';

/**
 * Guest-capacity override: a hotel admin can book more guests than a room's limit (with extra beds)
 * after ticking "Allow over capacity" and giving a reason; the hotel switch decides whether front desk can too.
 *
 * Prerequisites: STAFF_EMAIL is a hotel admin, and at least one room type is free on the dates below.
 * Not run yet — written alongside the feature.
 */

test('the Booking rules switch turns front-desk override on and off', async ({ page }) => {
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/settings/booking-rules`);
	await page.waitForLoadState('networkidle'); // click only after hydration
	const toggle = page.getByRole('switch', { name: 'Let front desk override guest capacity' });
	const start = await toggle.getAttribute('aria-checked');

	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-checked', start === 'true' ? 'false' : 'true');

	// Put it back the way it was.
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-checked', start ?? 'false');
});

test('an admin can search a party over every room limit once "Allow over capacity" is ticked', async ({ page }) => {
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/front-desk`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /walk-in/i }).first().click();

	await page.getByLabel('Check-in').first().fill(futureDate(30));
	await page.getByLabel('Check-out').first().fill(futureDate(31));
	await page.getByLabel('Guests').first().fill('12');
	await page.getByRole('button', { name: 'Check availability' }).first().click();

	// Nothing fits 12 guests in one room, so the override block appears.
	const allow = page.getByLabel(/Allow over capacity/);
	test.skip((await allow.count()) === 0, 'A room type here already fits 12 guests.');
	await allow.check();
	await page.getByLabel('Reason').first().fill('Family insisted on extra beds');

	// With the override on, the search lists room types again.
	await expect(page.getByText(/extra bed/i).first()).toBeVisible();
});
