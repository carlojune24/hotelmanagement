import { expect, test } from 'playwright/test';
import { SLUG, futureDate, staffLogin } from './helpers';
import { closeDb, hotelIdFor, sql } from './db';

/**
 * Dining → Reservations → New reservation with a pre-order: staff pick dishes for a phone booking,
 * book the table, and take full payment right away (like an online pre-order). The order is a
 * `pre_order` tied to the reservation, timed for its seating, and paid.
 *
 * Prerequisites: a venue with tables and a menu with an available dish, and a bank / e-wallet
 * account for GCash (Finance settings).
 */

let hotelId: string | null = null;
test.beforeAll(async () => {
	hotelId = await hotelIdFor(SLUG);
});
test.afterAll(closeDb);

test('staff book a table with a pre-order and take full payment', async ({ page }) => {
	test.skip(!hotelId, `No hotel with slug "${SLUG}". Set E2E_HOTEL_SLUG.`);
	const guest = `Pre E2E ${Date.now().toString().slice(-6)}`;
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/dining/reservations`);

	await expect(async () => {
		await page.getByRole('button', { name: 'New reservation' }).click();
		await expect(page.getByRole('heading', { name: 'New reservation' })).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 30_000 });
	const sheet = page.getByRole('dialog', { name: 'New reservation' });
	await sheet.getByLabel('Date').fill(futureDate(3));
	await sheet.getByLabel('Or any time').fill('19:00');
	await sheet.getByLabel('Guest name').fill(guest);
	await sheet.getByLabel('Mobile').fill('09170000000');

	// Pick a dish in the menu sheet, then bring it back.
	const add = sheet.getByRole('button', { name: /Add dishes/ });
	test.skip((await add.count()) === 0, 'This venue has no menu.');
	await add.click();
	const menu = page.locator('section[aria-label="Menu"]');
	await expect(menu).toBeVisible();
	const dish = menu.locator('li > button:not([disabled])').first();
	test.skip((await dish.count()) === 0, 'No available dish on the menu.');
	await dish.click();
	const addToOrder = page.getByRole('button', { name: 'Add to order' });
	if (await addToOrder.isVisible().catch(() => false)) await addToOrder.click();
	await page.getByRole('button', { name: 'Use these dishes' }).click();
	await expect(sheet.getByText('Paid in full after booking')).toBeVisible();

	await sheet.getByRole('button', { name: /^Book table and pre-order ₱/ }).click();

	// Take payment opens on the new pre-order.
	const pay = page.getByRole('dialog', { name: 'Take payment' });
	await expect(pay).toBeVisible({ timeout: 20_000 });
	await pay.getByRole('radio', { name: 'GCash' }).click();
	await pay.getByLabel('Reference no.').fill(`PRE-${Date.now().toString().slice(-6)}`);
	await pay.getByRole('button', { name: /^Record ₱/ }).click();

	await expect
		.poll(
			async () =>
				(
					await sql<{ t: string; p: string; s: string; on_time: boolean }[]>`
						select o.order_type as t, o.payment_status as p, o.source as s, o.pickup_at = r.starts_at as on_time
						from dining_orders o join dining_reservations r on r.id = o.reservation_id
						where o.hotel_id = ${hotelId} and r.guest_name = ${guest}`
				)[0],
			{ timeout: 20_000 }
		)
		.toEqual({ t: 'pre_order', p: 'paid', s: 'staff', on_time: true });
});
