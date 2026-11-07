import { expect, test } from 'playwright/test';
import { SLUG, futureDate, reserveAsGuest, staffLogin } from './helpers';
import { closeDb, hotelIdFor, sql } from './db';

/**
 * A table reservation with a pre-order only needs online payment. It works with takeaway "Online
 * ordering" switched off for the venue.
 *
 * Prerequisites: the first venue takes reservations and PayMongo is connected. The spec turns
 * takeaway off through the staff settings page and turns it back on when it finishes.
 */

test.afterAll(closeDb);

test('guests can reserve and pre-order with takeaway ordering switched off', async ({ page, browser }) => {
	const hotelId = await hotelIdFor(SLUG);
	const [venue] = await sql<{ id: string; on: boolean }[]>`
		select id, online_orders_enabled as on from dining_items
		where hotel_id = ${hotelId} and is_active and reservations_enabled
		order by sort_order, title limit 1`;
	test.skip(!venue, 'No venue takes reservations.');

	await staffLogin(page);
	const settings = `/${SLUG}/management/dining/settings/${venue!.id}`;
	const setTakeaway = async (on: boolean) => {
		await page.goto(settings, { waitUntil: 'networkidle' });
		const sw = page.locator('#ooEnabled');
		if ((await sw.getAttribute('aria-checked')) !== String(on)) await sw.click();
		await page.getByRole('button', { name: 'Save online ordering' }).click();
		await expect(page.getByText(/Online ordering (is on|settings saved)/)).toBeVisible();
	};

	await setTakeaway(false);
	try {
		await expect(page.getByText('until Online ordering above is on')).toHaveCount(0);

		const guest = await (await browser.newContext()).newPage();
		await guest.goto(`/${SLUG}/dining/reserve?venue=${venue!.id}&date=${futureDate(4)}&party=2`);
		test.skip(await guest.getByText('Online reservations are not open right now').isVisible(), 'PayMongo is not connected.');

		await reserveAsGuest(guest);
		await expect(guest).toHaveURL(/\/dining\/order\?.*reservation=TB-/);
		await expect(guest.getByText('Back to your reservation')).toBeVisible();
	} finally {
		if (venue!.on) await setTakeaway(true);
	}
});
