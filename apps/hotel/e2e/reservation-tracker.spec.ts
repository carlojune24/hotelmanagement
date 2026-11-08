import { expect, test } from 'playwright/test';
import { SLUG, futureDate, staffLogin } from './helpers';
import { closeDb, hotelIdFor, sql } from './db';

/**
 * The guest's reservation ticket tracks the table and the food ("Your evening"). A booking with a
 * pre-order shows the table as reserved and the food as scheduled: the kitchen starts it the venue's
 * prep time (Dining settings) before the table. Once staff seat the party, the ticket says so.
 *
 * Prerequisites: a venue with tables and a menu with an available dish.
 */

let hotelId: string | null = null;
test.beforeAll(async () => {
	hotelId = await hotelIdFor(SLUG);
});
test.afterAll(closeDb);

test('the reservation ticket tracks the table and the pre-order', async ({ page, browser }) => {
	test.skip(!hotelId, `No hotel with slug "${SLUG}". Set E2E_HOTEL_SLUG.`);
	const guest = `Track E2E ${Date.now().toString().slice(-6)}`;
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/dining/reservations`);

	// Staff book a table three days ahead with a pre-order (payment is left for later).
	await expect(async () => {
		await page.getByRole('button', { name: 'New reservation' }).click();
		await expect(page.getByRole('heading', { name: 'New reservation' })).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 30_000 });
	const sheet = page.getByRole('dialog', { name: 'New reservation' });
	await sheet.getByLabel('Date').fill(futureDate(3));
	await sheet.getByLabel('Or any time').fill('19:00');
	await sheet.getByLabel('Guest name').fill(guest);
	const add = sheet.getByRole('button', { name: /Add dishes/ });
	test.skip((await add.count()) === 0, 'This venue has no menu.');
	await add.click();
	const dish = page.locator('section[aria-label="Menu"] li > button:not([disabled])').first();
	test.skip((await dish.count()) === 0, 'No available dish on the menu.');
	await dish.click();
	const addToOrder = page.getByRole('button', { name: 'Add to order' });
	if (await addToOrder.isVisible().catch(() => false)) await addToOrder.click();
	await page.getByRole('button', { name: 'Use these dishes' }).click();
	await sheet.getByRole('button', { name: /^Book table and pre-order/ }).click();
	await expect(page.getByRole('dialog', { name: 'Take payment' })).toBeVisible({ timeout: 20_000 });
	await page.keyboard.press('Escape');

	const [r] = await sql<{ id: string; code: string; token: string; prep: number }[]>`
		select r.id, r.code, r.access_token as token, v.prep_minutes as prep
		from dining_reservations r join dining_items v on v.id = r.dining_item_id
		where r.hotel_id = ${hotelId} and r.guest_name = ${guest}`;
	expect(r, 'the reservation was saved').toBeTruthy();

	// The guest's ticket (no sign-in): table reserved, food scheduled for the prep time before the table.
	const ctx = await browser.newContext();
	const guestPage = await ctx.newPage();
	const ticket = `/${SLUG}/dining/reserve/${r!.code}?t=${r!.token}`;
	await guestPage.goto(ticket);
	const evening = guestPage.getByRole('region', { name: 'Your evening' });
	await expect(evening).toBeVisible();
	await expect(evening.getByText(/Your table is ready for you at/)).toBeVisible();
	await expect(evening.getByText(new RegExp(`${r!.prep} minutes before your table`))).toBeVisible();
	await expect(evening.getByText(/^Kitchen \d/).first()).toBeAttached();

	// Staff seat the party: the ticket follows.
	await page.goto(`/${SLUG}/management/dining/reservations?tab=upcoming&q=${encodeURIComponent(guest)}`);
	await page.getByRole('button', { name: `Actions for ${guest}` }).click();
	await page.getByRole('menuitem', { name: 'Mark seated' }).click();
	await expect
		.poll(async () => (await sql<{ s: string }[]>`select status as s from dining_reservations where id = ${r!.id}`)[0]?.s, { timeout: 15_000 })
		.toBe('seated');
	await guestPage.reload();
	await expect(guestPage.getByRole('region', { name: 'Your evening' }).getByText(/You are seated/)).toBeVisible();
	await ctx.close();
});
