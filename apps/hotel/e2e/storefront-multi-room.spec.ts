import { expect, test } from 'playwright/test';
import { SLUG, futureDate } from './helpers';

/**
 * A party too big for one room: 3 guests choose 1 room + extra bed or 2 rooms (cheaper picked first);
 * 4 guests book 2 rooms through a confirmation that lists who sleeps where.
 *
 * Prerequisites: a room type that sleeps 2 with 1 extra bed allowed (e.g. Deluxe Studio) and a
 * "Good for 2" rate, with at least 2 rooms free for the dates below. Skips itself otherwise.
 */
const checkIn = futureDate(24);
const checkOut = futureDate(25);
const home = (adults: number) => `/${SLUG}?checkIn=${checkIn}&checkOut=${checkOut}&adults=${adults}&children=0`;
const peso = (s: string | null) => Number((s ?? '').replace(/[^\d.]/g, ''));

test('3 guests: a rate offers 1 room + extra bed or 2 rooms, cheaper one picked', async ({ page }) => {
	await page.goto(home(3));
	await page.waitForLoadState('networkidle'); // click only after hydration
	const opts = page.locator('.sf-rate-opts').first();
	test.skip((await opts.count()) === 0, 'No rate fits 3 guests both as 1 room + extra bed and as 2 rooms.');
	const [a, b] = [opts.getByRole('radio').nth(0), opts.getByRole('radio').nth(1)];
	await expect(a).toContainText('1 room + extra bed');
	await expect(b).toContainText('2 rooms');
	const [pa, pb] = [peso(await a.locator('.ledger-data').textContent()), peso(await b.locator('.ledger-data').textContent())];
	await expect(pa <= pb ? a : b).toHaveAttribute('aria-checked', 'true');

	// Switching to 2 rooms changes the Reserve button and asks for confirmation; Change guests backs out.
	const rate = page.locator('.sf-rate', { has: opts });
	await b.click();
	await rate.getByRole('button', { name: 'Reserve 2 rooms' }).click();
	await expect(page.getByRole('dialog')).toContainText('Your party of 3 needs 2 rooms');
	await page.getByRole('button', { name: 'Change guests' }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page).not.toHaveURL(/\/details/);
});

test('4 guests: 2 rooms, confirmed room by room, land in the cart as one 2-room line', async ({ page }) => {
	await page.goto(home(4));
	await page.waitForLoadState('networkidle'); // click only after hydration
	const rate = page.locator('.sf-rate').filter({ has: page.getByRole('button', { name: 'Reserve 2 rooms' }) }).first();
	test.skip((await rate.count()) === 0, 'No room type has 2 rooms free for 4 guests on these dates.');
	const reserve = rate.getByRole('button', { name: 'Reserve 2 rooms' });
	// Only one way to fit 4 here, so no choice is shown on that rate.
	await expect(rate.locator('.sf-rate-opts')).toHaveCount(0);
	await expect(rate).toContainText('2 rooms for your party · 2 guests each');

	await reserve.click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('Your party of 4 needs 2 rooms');
	await expect(dialog.locator('.sf-split-rooms li')).toHaveText([/Room 1\s*2 guests/, /Room 2\s*2 guests/]);
	await dialog.getByRole('button', { name: 'Book 2 rooms' }).click();
	await expect(page).toHaveURL(/\/details/);
	await expect(page.getByText(/· 2 rooms/).first()).toBeVisible();
});

test('2 adults: no 2-room offer, and "Good for 1" rates stay disabled', async ({ page }) => {
	await page.goto(home(2));
	await expect(page.getByRole('button', { name: /^Reserve \d+ rooms$/ })).toHaveCount(0);
	const unfit = page.locator('.sf-rate.is-unfit');
	if ((await unfit.count()) > 0) await expect(unfit.first().getByRole('button', { name: 'Reserve' })).toBeDisabled();
});
