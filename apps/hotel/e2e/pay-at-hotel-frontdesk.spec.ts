import { expect, test, type Page } from 'playwright/test';
import { SLUG, staffLogin, uniqueGuest } from './helpers';
import { sql } from './db';

/**
 * A pay-at-hotel booking (made while PayMongo is paused) goes through the front desk like any other: the guest
 * is checked in with the whole balance still owing, check-out is blocked until it is paid, then it goes through.
 *
 *   E2E_HOTEL_SLUG=mmhotel pnpm exec playwright test e2e/pay-at-hotel-frontdesk.spec.ts
 *
 * Books a room for TODAY, so a room of the cheapest type must be free tonight. Pauses PayMongo while it books
 * and un-pauses afterwards. Leaves its (checked-out) booking behind, guest name "E2E Guest …".
 */

async function setPaused(page: Page, paused: boolean) {
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/settings/payments-email`, { waitUntil: 'networkidle' });
	const toggle = page.getByRole('button', { name: paused ? 'Pause online payments' : 'Resume online payments' });
	if (await toggle.count()) await toggle.click();
	await expect(page.getByRole('button', { name: paused ? 'Resume online payments' : 'Pause online payments' })).toBeVisible();
}

/** Today and tomorrow in the hotel's own timezone (the business date the front desk uses). */
async function hotelDays() {
	const [h] = await sql`select timezone from hotels where slug = ${SLUG}`;
	const fmt = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: h!.timezone as string }).format(new Date(ms));
	return { today: fmt(Date.now()), tomorrow: fmt(Date.now() + 86_400_000) };
}

/** The check-in form holds the rate plan's security deposit; it blocks check-out until settled (housekeeping sign-off or admin override). */
async function settleDepositIfHeld(page: Page) {
	// The room's detail loads after the tile is clicked; wait for the deposit section instead of racing it.
	const held = page.getByRole('heading', { name: 'Security deposit' });
	await held.waitFor({ timeout: 8000 }).catch(() => undefined);
	const settle = page.getByRole('button', { name: 'Settle deposit' });
	if ((await settle.count()) === 0) return;
	if (await settle.isDisabled()) {
		await page.getByRole('button', { name: /Admin override/ }).click();
		await page.getByRole('button', { name: /Yes, skip the check and settle/ }).click();
	} else {
		await settle.click();
	}
	await expect(page.getByText(/Settled — /).first()).toBeVisible();
}

test.describe.serial('pay-at-hotel · front desk', () => {
	let orderId = '';
	let bookingId = '';
	let roomNumber = '';

	test.afterAll(async ({ browser }) => {
		const page = await browser.newPage();
		await setPaused(page, false).catch(() => undefined);
		await page.close();
	});

	test('book while paused, then check in with the full balance still owing', async ({ page, browser }) => {
		const staff = await browser.newPage();
		await setPaused(staff, true);
		await staff.close();

		const { today, tomorrow } = await hotelDays();
		const guest = uniqueGuest();
		await page.goto(`/${SLUG}?checkIn=${today}&checkOut=${tomorrow}&adults=2&children=0`, { waitUntil: 'networkidle' });
		const reserve = page.getByRole('button', { name: /^Reserve$/ }).first();
		test.skip((await reserve.count()) === 0, 'No rate can be reserved for tonight.');
		await reserve.click();
		await page.locator('#fullName').fill(guest.name);
		await page.locator('#email').fill(guest.email);
		await page.locator('#phone').fill(guest.phone);
		await page.getByRole('button', { name: /Continue to review/i }).click();
		await page.getByRole('button', { name: /Confirm booking — pay .* at the hotel/ }).click();
		await expect(page).toHaveURL(/\/confirmation\//);
		orderId = new URL(page.url()).pathname.split('/').pop()!;
		const [b] = await sql`select id from bookings where order_id = ${orderId} limit 1`;
		bookingId = b!.id as string;

		// Staff open the reservation and check the guest in.
		await staffLogin(page);
		await page.goto(`/${SLUG}/management/reservations/room/${bookingId}`, { waitUntil: 'networkidle' });
		const form = page.locator('form#check-in');
		const roomSelect = form.locator('select[name="roomId"]').first();
		if (await roomSelect.count()) {
			const options = await roomSelect.locator('option:not([disabled])').all();
			test.skip(options.length === 0, 'No room of this type is free to check into.');
			await roomSelect.selectOption({ index: 1 });
		}
		await form.getByRole('button', { name: 'Check in' }).click();
		await expect.poll(async () => (await sql`select status from bookings where id = ${bookingId}`)[0]!.status, { timeout: 15_000 }).toBe('checked_in');

		// Checked in with nothing paid and the whole total on the folio.
		const [paid] = await sql`select count(*)::int as n from payments where order_id = ${orderId} and status = 'paid'`;
		expect(paid!.n).toBe(0);
		const [r] = await sql`
			select r.room_number from room_assignments ra
			join booking_rooms br on br.id = ra.booking_room_id
			join rooms r on r.id = ra.room_id
			where br.booking_id = ${bookingId} limit 1`;
		roomNumber = String(r!.room_number);
	});

	test('check-out is blocked while the balance is unpaid', async ({ page }) => {
		test.skip(!roomNumber, 'The check-in test did not run.');
		await staffLogin(page);
		await page.goto(`/${SLUG}/management/front-desk`, { waitUntil: 'networkidle' });
		await page.locator('button', { hasText: new RegExp(`\\b${roomNumber}\\b`) }).first().click();
		await expect(page.getByText(/still due — take payment in the Folio section/)).toBeVisible();

		// With the deposit out of the way, the unpaid balance alone still blocks check-out.
		await settleDepositIfHeld(page);
		const checkout = page.getByRole('button', { name: /^Check out( early)?$/ });
		await expect(checkout).toBeDisabled();
		await expect(page.getByText(/still due — take payment in the Folio section/)).toBeVisible();
		await page.waitForTimeout(500);
		const [b] = await sql`select status from bookings where id = ${bookingId}`;
		expect(b!.status).toBe('checked_in');
	});

	test('pay the balance, then check out goes through', async ({ page }) => {
		test.skip(!roomNumber, 'The check-in test did not run.');
		await staffLogin(page);
		await page.goto(`/${SLUG}/management/transactions/${orderId}`, { waitUntil: 'networkidle' });
		await page.getByRole('button', { name: /Take payment/ }).click();
		const dialog = page.getByRole('dialog');
		await dialog.locator('select[name="method"]').selectOption('gcash');
		await dialog.locator('input[name="referenceNo"]').fill(`E2E-FD-${Date.now()}`);
		await dialog.getByRole('button', { name: 'Record payment' }).click();
		await expect(dialog).toHaveCount(0);

		await page.goto(`/${SLUG}/management/front-desk`, { waitUntil: 'networkidle' });
		await page.locator('button', { hasText: new RegExp(`\\b${roomNumber}\\b`) }).first().click();
		await expect(page.getByText(/still due — take payment in the Folio section/)).toHaveCount(0);
		await page.getByRole('button', { name: /^Check out( early)?$/ }).click();
		await expect.poll(async () => (await sql`select status from bookings where id = ${bookingId}`)[0]!.status, { timeout: 15_000 }).toBe('checked_out');
	});
});
