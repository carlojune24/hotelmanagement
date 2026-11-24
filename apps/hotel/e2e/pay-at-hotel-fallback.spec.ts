import { expect, test, type Page } from 'playwright/test';
import { SLUG, futureDate, staffLogin, uniqueGuest } from './helpers';
import { sql } from './db';

/**
 * PayMongo down / account closed: staff flip "Pause online payments" (Settings → Payments & email) and an
 * online booking confirms as pay-at-the-hotel instead of failing — nothing charged, the whole bill due at the desk.
 *
 *   E2E_HOTEL_SLUG=mmhotel pnpm exec playwright test e2e/pay-at-hotel-fallback.spec.ts
 *
 * Prerequisites: PayMongo is connected for the hotel (it is never called while paused), staff login works, and a
 * room is free on the dates below. The migration adding `paymongo_settings.paused` must be applied.
 * Leaves its test bookings behind (guest names start "E2E Guest"); always un-pauses the hotel afterwards.
 * The dead-PayMongo (automatic) path is in pay-at-hotel-dead-paymongo.spec.ts.
 */
const checkIn = futureDate(40);
const checkOut = futureDate(41);
const MAINTENANCE =
	'Your reservation is successful, but please make the payment at the hotel (walk-in) because PayMongo is under maintenance.';

async function setPaused(page: Page, paused: boolean) {
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/settings/payments-email`, { waitUntil: 'networkidle' });
	const toggle = page.getByRole('button', { name: paused ? 'Pause online payments' : 'Resume online payments' });
	if (await toggle.count()) await toggle.click();
	await expect(page.getByRole('button', { name: paused ? 'Resume online payments' : 'Pause online payments' })).toBeVisible();
}

/** Guest fills the cart for the test dates and lands on the review page. Returns null when no rate is bookable. */
async function guestToReview(page: Page) {
	const guest = uniqueGuest();
	await page.goto(`/${SLUG}?checkIn=${checkIn}&checkOut=${checkOut}&adults=2&children=0`, { waitUntil: 'networkidle' });
	const reserve = page.getByRole('button', { name: /^Reserve$/ }).first();
	if ((await reserve.count()) === 0) return null;
	await reserve.click();
	await expect(page).toHaveURL(/\/details/);
	await page.locator('#fullName').fill(guest.name);
	await page.locator('#email').fill(guest.email);
	await page.locator('#phone').fill(guest.phone);
	await page.getByRole('button', { name: /Continue to review/i }).click();
	await expect(page).toHaveURL(/\/review\//);
	return guest;
}

const orderIdFrom = (url: string) => new URL(url).pathname.split('/').pop()!;

test.describe.serial('pay-at-hotel fallback', () => {
	let orderId = '';

	test.afterAll(async ({ browser }) => {
		// Never leave the hotel paused for the next spec.
		const page = await browser.newPage();
		await setPaused(page, false).catch(() => undefined);
		await page.close();
	});

	test('paused: the guest books, confirms, and is told to pay at the hotel', async ({ page, browser }) => {
		const staff = await browser.newPage();
		await setPaused(staff, true);
		await staff.close();

		const guest = await guestToReview(page);
		test.skip(!guest, 'No rate can be reserved for these dates.');

		// Review page: pay-at-the-hotel wording, no PayMongo and no downpayment choice.
		await expect(page.getByText(/with PayMongo/i)).toHaveCount(0);
		await expect(page.getByText(/How much would you like to pay now/i)).toHaveCount(0);
		await expect(page.getByText(/PayMongo is under maintenance/i)).toBeVisible();
		const confirm = page.getByRole('button', { name: /Confirm booking — pay .* at the hotel/ });
		await expect(confirm).toBeVisible();
		await confirm.click();

		// Confirmed with nothing paid: says what is due at the hotel, never "Total paid".
		await expect(page).toHaveURL(/\/confirmation\//);
		orderId = orderIdFrom(page.url());
		await expect(page.getByText(MAINTENANCE.replace(/\s+/g, ' '))).toBeVisible();
		await expect(page.getByText('Due at the hotel').first()).toBeVisible();
		await expect(page.getByText('Total paid')).toHaveCount(0);
		await expect(page.getByText('Payment reference')).toHaveCount(0);
		await expect(page.getByText(/Pay the full/)).toBeVisible();

		// A refresh keeps the same, honest state.
		await page.reload();
		await expect(page.getByText('Due at the hotel').first()).toBeVisible();
		await expect(page.getByText('Total paid')).toHaveCount(0);
	});

	test('paused: the order, bookings, money trail and audit say the same thing', async () => {
		test.skip(!orderId, 'The booking test did not run.');
		const [o] = await sql`select status, amount_due_now_centavos, total_centavos from orders where id = ${orderId}`;
		expect(o!.status).toBe('confirmed');
		expect(Number(o!.amount_due_now_centavos)).toBe(0);
		expect(Number(o!.total_centavos)).toBeGreaterThan(0);

		const lines = await sql`select status from bookings where order_id = ${orderId}`;
		expect(lines.length).toBeGreaterThan(0);
		expect(lines.every((b) => b.status === 'confirmed')).toBe(true);

		// Nothing was charged and PayMongo was never asked.
		const [{ n: paid }] = await sql`select count(*)::int as n from payments where order_id = ${orderId}`;
		const [{ n: attempts }] = await sql`select count(*)::int as n from payment_attempts where order_id = ${orderId}`;
		expect(paid).toBe(0);
		expect(attempts).toBe(0);

		const [h] = await sql`select note from order_status_history where order_id = ${orderId} and to_status = 'confirmed'`;
		expect(h!.note).toMatch(/^Pay at hotel/);
		const [a] = await sql`select count(*)::int as n from audit_log where entity_id = ${orderId} and action = 'order.pay_at_hotel'`;
		expect(a!.n).toBe(1);
	});

	test('paused: staff see the order as unpaid with an accurate note', async ({ page }) => {
		test.skip(!orderId, 'The booking test did not run.');
		await staffLogin(page);
		await page.goto(`/${SLUG}/management/transactions/${orderId}`);
		await expect(page.getByText(/Booked as pay-at-the-hotel/)).toBeVisible();
		await expect(page.getByText(/The guest paid the downpayment online/)).toHaveCount(0);
	});

	test('paused: staff collect the whole balance at the desk and the booking settles', async ({ page, context }) => {
		test.skip(!orderId, 'The booking test did not run.');
		await staffLogin(page);
		await page.goto(`/${SLUG}/management/transactions/${orderId}`, { waitUntil: 'networkidle' });
		await page.getByRole('button', { name: /Take payment/ }).click();
		const dialog = page.getByRole('dialog');
		await dialog.locator('select[name="method"]').selectOption('gcash');
		await dialog.locator('input[name="referenceNo"]').fill(`E2E-PAH-${Date.now()}`);
		await dialog.getByRole('button', { name: 'Record payment' }).click();
		await expect(dialog).toHaveCount(0);
		await expect(page.getByText('Settled').first()).toBeVisible();
		await expect(page.getByText(/Booked as pay-at-the-hotel/)).toHaveCount(0);

		// One real payment for the whole total, with a cash trail behind it.
		const [o] = await sql`select total_centavos from orders where id = ${orderId}`;
		const pays = await sql`select id, amount_centavos from payments
			where order_id = ${orderId} and status = 'paid' and voided_at is null and purpose <> 'refund'`;
		expect(pays.length).toBe(1);
		expect(Number(pays[0]!.amount_centavos)).toBe(Number(o!.total_centavos));
		const [{ n: moves }] = await sql`select count(*)::int as n from cash_movements
			where source_id::text = ${pays[0]!.id as string} and voided_at is null`;
		expect(moves).toBeGreaterThan(0);

		// The guest's own page now reads as paid, not as owing — the pay-at-hotel notice is gone.
		const token = (await sql`select access_token from orders where id = ${orderId}`)[0]!.access_token as string;
		const guestPage = await context.newPage();
		await guestPage.goto(`/${SLUG}/confirmation/${orderId}?t=${token}`);
		await expect(guestPage.getByText('Total paid')).toBeVisible();
		await expect(guestPage.getByText(/PayMongo is under maintenance/)).toHaveCount(0);
		await guestPage.close();
	});

	test('paused: cancelling an unpaid pay-at-hotel booking just releases it', async ({ page }) => {
		const guest = await guestToReview(page);
		test.skip(!guest, 'No rate can be reserved for these dates.');
		await page.getByRole('button', { name: /Confirm booking — pay .* at the hotel/ }).click();
		await expect(page).toHaveURL(/\/confirmation\//);
		const id = orderIdFrom(page.url());
		const [b] = await sql`select id from bookings where order_id = ${id} limit 1`;

		await staffLogin(page);
		await page.goto(`/${SLUG}/management/reservations/room/${b!.id}`, { waitUntil: 'networkidle' });
		await page.getByRole('button', { name: 'Cancel booking' }).first().click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByText('Paid to date')).toBeVisible();
		await expect(dialog.getByText('Refund via')).toHaveCount(0); // nothing was paid, so nothing to refund
		await dialog.locator('#cancel-reason').fill('E2E: pay-at-hotel cancel');
		await dialog.getByRole('button', { name: 'Cancel booking' }).click();
		await expect(dialog).toHaveCount(0);

		const [o] = await sql`select status from orders where id = ${id}`;
		expect(o!.status).toBe('cancelled');
		const [{ n: refunds }] = await sql`select count(*)::int as n from payments where order_id = ${id}`;
		expect(refunds).toBe(0);
	});

	test('resumed: the review page offers PayMongo again and sends the guest to its checkout', async ({ page, browser }) => {
		const staff = await browser.newPage();
		await setPaused(staff, false);
		await staff.close();

		const guest = await guestToReview(page);
		test.skip(!guest, 'No rate can be reserved for these dates.');
		const pay = page.getByRole('button', { name: /with PayMongo/i });
		await expect(pay).toBeVisible();
		await expect(page.getByText(/PayMongo is under maintenance/i)).toHaveCount(0);
		const id = orderIdFrom(page.url());

		await pay.click();
		await page.waitForURL((u) => !u.pathname.includes('/review/'), { timeout: 60_000 });
		// Went to PayMongo (or, if it cannot be reached, fell back) — and left a trail either way.
		const [o] = await sql`select status from orders where id = ${id}`;
		const [{ n: attempts }] = await sql`select count(*)::int as n from payment_attempts where order_id = ${id}`;
		if (/\/confirmation\//.test(page.url())) {
			expect(o!.status).toBe('confirmed'); // fell back
		} else {
			expect(o!.status).toBe('pending_payment'); // sitting on PayMongo's page; the hold sweep releases it
			expect(attempts).toBe(1);
		}
	});

	test('an already-open PayMongo link is closed when the booking falls back to pay-at-hotel', async ({ page, browser }) => {
		const staff = await browser.newPage();
		await setPaused(staff, false);
		await staff.close();
		const guest = await guestToReview(page);
		test.skip(!guest, 'No rate can be reserved for these dates.');
		const reviewUrl = page.url();
		const id = orderIdFrom(reviewUrl);

		// The guest opens PayMongo checkout (a real test-mode session) but does not pay.
		await page.getByRole('button', { name: /with PayMongo/i }).click();
		await page.waitForURL((u) => !u.pathname.includes('/review/'), { timeout: 60_000 });
		const [att] = await sql`select id, checkout_session_id, status from payment_attempts where order_id = ${id}`;
		expect(att!.status).not.toBe('expired');

		// PayMongo is then paused; the guest comes back to the same review page and confirms.
		const staff2 = await browser.newPage();
		await setPaused(staff2, true);
		await staff2.close();
		await page.goto(reviewUrl);
		await page.getByRole('button', { name: /Confirm booking — pay .* at the hotel/ }).click();
		await expect(page).toHaveURL(/\/confirmation\//);

		// The old link can no longer be paid: closed on our side and at PayMongo.
		const [after] = await sql`select status from payment_attempts where id = ${att!.id as string}`;
		expect(after!.status).toBe('expired');
		const res = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${att!.checkout_session_id}`, {
			headers: { Authorization: 'Basic ' + Buffer.from(process.env.PAYMONGO_SECRET_KEY_TEST + ':').toString('base64') }
		});
		expect(res.ok).toBe(true);
		expect(((await res.json()) as { data: { attributes: { status: string } } }).data.attributes.status).toBe('expired');
	});
});
