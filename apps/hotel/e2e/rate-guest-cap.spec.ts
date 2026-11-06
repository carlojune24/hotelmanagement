import { expect, test } from 'playwright/test';
import { SLUG, futureDate, staffLogin } from './helpers';

/**
 * Rate plan "Good for N guests" cap + the Reservations list total.
 *
 * Prerequisites: at least one active rate plan with "Good for (guests per room)" = 1 in Rates &
 * policies (e.g. "Deluxe Studio Rate (Good for 1 Guests)"), free for the dates below. The list-total
 * test needs one in-house stay; both tests skip themselves when the data is not there.
 */

test('a 1-guest rate is greyed out and cannot be reserved by 2 adults', async ({ page }) => {
	const checkIn = futureDate(20);
	const checkOut = futureDate(21);
	await page.goto(`/${SLUG}?checkIn=${checkIn}&checkOut=${checkOut}&adults=2&children=0`);
	const unfit = page.locator('.sf-rate.is-unfit');
	test.skip((await unfit.count()) === 0, 'No rate plan has "Good for" set below 2 guests.');
	await expect(unfit.first()).toContainText('Good for up to 1 guest');
	await expect(unfit.first().getByRole('button', { name: 'Reserve' })).toBeDisabled();
	// "Lowest price" never lands on a rate the party cannot book.
	await expect(page.locator('.sf-rate.is-unfit .sf-rate-best')).toHaveCount(0);

	// One adult: the same rates are bookable again.
	await page.goto(`/${SLUG}?checkIn=${checkIn}&checkOut=${checkOut}&adults=1&children=0`);
	await expect(page.locator('.sf-rate.is-unfit')).toHaveCount(0);
});

test('an extra bed lets a 2-guest rate take 3 guests, charged at the rate\'s bed fee', async ({ page }) => {
	const checkIn = futureDate(20);
	const checkOut = futureDate(21);
	await page.goto(`/${SLUG}?checkIn=${checkIn}&checkOut=${checkOut}&adults=3&children=0`);
	const withBed = page.locator('.sf-rate:not(.is-unfit)', { hasText: 'extra bed' });
	test.skip((await withBed.count()) === 0, 'No room type allows an extra bed for 3 guests.');
	await expect(withBed.first().getByRole('button', { name: 'Reserve' })).toBeEnabled();
	await expect(withBed.first()).toContainText('Includes 1 extra bed');
});

test('a party bigger than one room gets the real reason and a way to book what fits', async ({ page }) => {
	const checkIn = futureDate(20);
	const checkOut = futureDate(21);
	await page.goto(`/${SLUG}?checkIn=${checkIn}&checkOut=${checkOut}&adults=10&children=0`);
	await expect(page.getByText('Too many guests for one room').first()).toBeVisible();
	const bookFor = page.getByRole('button', { name: /^Book for \d+ guests$/ }).first();
	await bookFor.click();
	await expect(page).not.toHaveURL(/adults=10/);
});

test('changing the party in a room card re-checks without pressing Show prices', async ({ page }) => {
	const checkIn = futureDate(20);
	const checkOut = futureDate(21);
	await page.goto(`/${SLUG}?checkIn=${checkIn}&checkOut=${checkOut}&adults=1&children=0`);
	await page.getByRole('button', { name: 'Change dates' }).first().click();
	await page.locator('.sf-roompick').getByRole('button', { name: 'More adults' }).click();
	await expect(page).toHaveURL(/adults=2/);
});

test('the Reservations list total matches the stay page total (add-ons included)', async ({ page }) => {
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/reservations?view=in-house`);
	const row = page.locator('tbody tr').first();
	test.skip((await row.count()) === 0 || (await row.textContent())?.includes('No ') === true, 'Nobody is in-house.');
	const listTotal = (await row.locator('td', { hasText: '₱' }).last().textContent())!.replace(/[^\d.]/g, '');
	await row.click();
	await expect(page).toHaveURL(/\/reservations\/(room|hall)\//);
	const glanceTotal = page.getByText('At a glance').locator('..').locator('..').getByText(/₱/).first();
	await expect(glanceTotal).toBeVisible();
	expect((await glanceTotal.textContent())!.replace(/[^\d.]/g, '')).toBe(listTotal);
});
