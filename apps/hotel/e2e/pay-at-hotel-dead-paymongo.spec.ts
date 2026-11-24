import { expect, test } from 'playwright/test';
import { SLUG, futureDate, uniqueGuest } from './helpers';
import { sql } from './db';

/**
 * PayMongo is dead but staff did NOT pause it (the account was closed, the key revoked, an outage): the guest
 * clicks "Pay", PayMongo answers 401 (or never answers), and the booking still confirms as pay-at-the-hotel.
 *
 * Needs a server whose PayMongo client has never been used with the good key (the app caches it per hotel), so it
 * is opt-in and set up by hand:
 *   1. replace the hotel's stored PayMongo secret with a wrong one (paymongo_settings.secret_key_enc),
 *   2. start a FRESH dev server (e.g. `pnpm exec vite dev --port 5176`),
 *   3. E2E_DEAD_PAYMONGO=1 E2E_BASE_URL=http://localhost:5176 E2E_HOTEL_SLUG=mmhotel \
 *        pnpm exec playwright test e2e/pay-at-hotel-dead-paymongo.spec.ts
 *   4. put the real secret back.
 * Hotel must NOT be paused.
 * To test a PayMongo that HANGS instead (keep the good key): start the fresh server with
 *   NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:9999
 * pointing at a socket that accepts and never answers, and add E2E_EXPECT_TIMEOUT=1.
 */
test('PayMongo rejects the key: the booking still confirms, pay at the hotel', async ({ page }) => {
	test.skip(process.env.E2E_DEAD_PAYMONGO !== '1', 'Opt-in: needs a wrong PayMongo key and a fresh server (see header).');
	const [{ paused }] = await sql`select paused from paymongo_settings limit 1`;
	expect(paused, 'the hotel must not be paused for this test').toBe(false);

	const guest = uniqueGuest();
	await page.goto(`/${SLUG}?checkIn=${futureDate(42)}&checkOut=${futureDate(43)}&adults=2&children=0`, { waitUntil: 'networkidle' });
	const reserve = page.getByRole('button', { name: /^Reserve$/ }).first();
	test.skip((await reserve.count()) === 0, 'No rate can be reserved for these dates.');
	await reserve.click();
	await page.locator('#fullName').fill(guest.name);
	await page.locator('#email').fill(guest.email);
	await page.locator('#phone').fill(guest.phone);
	await page.getByRole('button', { name: /Continue to review/i }).click();
	await expect(page).toHaveURL(/\/review\//);

	// Not paused, so the guest is offered PayMongo as usual…
	const pay = page.getByRole('button', { name: /with PayMongo/i });
	await expect(pay).toBeVisible();
	const started = Date.now();
	await pay.click();

	// …and when it fails, lands on the confirmation instead of an error page.
	await expect(page).toHaveURL(/\/confirmation\//, { timeout: 60_000 });
	const seconds = (Date.now() - started) / 1000;
	console.log(`fallback took ${seconds.toFixed(1)}s`);
	expect(seconds).toBeLessThan(30);
	// A PayMongo that never answers (E2E_EXPECT_TIMEOUT=1) is cut off by the 8s timeout, not by luck.
	if (process.env.E2E_EXPECT_TIMEOUT === '1') expect(seconds).toBeGreaterThan(7);
	await expect(page.getByText(/PayMongo is under maintenance/)).toBeVisible();
	await expect(page.getByText('Due at the hotel').first()).toBeVisible();
	await expect(page.getByText('Total paid')).toHaveCount(0);
	await expect(page.getByText(/Internal Error|500/)).toHaveCount(0);

	const id = new URL(page.url()).pathname.split('/').pop()!;
	const [o] = await sql`select status, amount_due_now_centavos from orders where id = ${id}`;
	expect(o!.status).toBe('confirmed');
	expect(Number(o!.amount_due_now_centavos)).toBe(0);
	const [h] = await sql`select note from order_status_history where order_id = ${id} and to_status = 'confirmed'`;
	expect(h!.note).toMatch(/^Pay at hotel — PayMongo unavailable/);
	const [{ n: paid }] = await sql`select count(*)::int as n from payments where order_id = ${id}`;
	const [{ n: open }] = await sql`select count(*)::int as n from payment_attempts where order_id = ${id} and status not in ('expired','failed')`;
	expect(paid).toBe(0);
	expect(open).toBe(0);
});
