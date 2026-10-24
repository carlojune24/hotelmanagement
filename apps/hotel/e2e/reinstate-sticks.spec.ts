import { expect, test } from 'playwright/test';
import { SLUG, futureDate, staffLogin, uniqueGuest } from './helpers';

/**
 * A reinstated booking must stay reinstated.
 *
 * The bug: `reinstateBooking` puts an unpaid booking back to `pending_payment` while
 * `orders.created_at` stays at its original value, and the hold sweep
 * (`expirePendingOrders`) measured its TTL from `created_at` — so a reinstated order was
 * already past the cutoff the instant it was reinstated, and the next sweep cancelled it
 * again. That sweep runs on every guest storefront page load, which is why the guest
 * opening the link in their email appeared to re-cancel their own reservation.
 *
 * The hold is now measured from the order's last entry into `pending_payment`, so a
 * reinstatement restarts the clock instead of starting out expired.
 *
 * Needs a short hold window and real waiting, so it is opt-in. Run the dev server with the
 * floor value and run this spec against it:
 *   PENDING_ORDER_TTL_MINUTES=5 pnpm dev
 *   E2E_REINSTATE=1 pnpm exec playwright test e2e/reinstate-sticks.spec.ts --headed
 *
 * Written, not yet run.
 */

const RUN = process.env.E2E_REINSTATE === '1';
/** Must match the server's `PENDING_ORDER_TTL_MINUTES` (floored at 5 by the app). */
const TTL_MIN = Number(process.env.E2E_HOLD_TTL_MINUTES ?? 5);
const TTL_MS = TTL_MIN * 60_000;

/** Books a room online and abandons the payment, leaving a `pending_payment` hold. */
async function startUnpaidBooking(page: import('playwright/test').Page) {
	const guest = uniqueGuest();
	await page.goto(`/${SLUG}/rooms?checkIn=${futureDate(21)}&checkOut=${futureDate(23)}&adults=2`);
	await page.getByRole('button', { name: /Book|Select|Reserve/ }).first().click();
	await page.waitForURL(/\/details/);
	await page.locator('input[name="fullName"], #fullName').fill(guest.name);
	await page.locator('input[name="phone"], #phone').fill(guest.phone);
	await page.locator('input[name="email"], #email').fill(guest.email);
	// Leave for PayMongo and come straight back without paying: the hold is already recorded.
	await page.getByRole('button', { name: /Pay|Continue|Confirm/ }).first().click();
	await page.waitForURL(/paymongo|\/review\//i, { timeout: 60_000 }).catch(() => undefined);
	return guest;
}

/** Opens the reservation staff-side and returns its detail URL. */
async function openReservation(page: import('playwright/test').Page, guestName: string) {
	await page.goto(`/${SLUG}/management/reservations?q=${encodeURIComponent(guestName)}`);
	const row = page.getByRole('link', { name: new RegExp(guestName, 'i') }).first();
	await expect(row).toBeVisible();
	await row.click();
	await page.waitForURL(/\/management\/reservations\/room\//);
	return page.url();
}

test.describe('a reinstated booking is not swept away again', () => {
	test.skip(!RUN, 'Set E2E_REINSTATE=1 and run the server with PENDING_ORDER_TTL_MINUTES=5.');
	test.setTimeout(TTL_MS * 3 + 120_000);

	test('reinstate restarts the hold instead of starting out expired', async ({ page }) => {
		const guest = await startUnpaidBooking(page);
		const detail = await openReservation(page, guest.name);

		// Let the hold lapse on its own, the way the live reservation did.
		await page.waitForTimeout(TTL_MS + 90_000);
		await page.goto(`/${SLUG}`); // a guest page load — this is what runs the sweep
		await page.goto(detail);
		await expect(page.getByText(/Cancelled/i).first()).toBeVisible();

		// Staff reinstate it.
		await page.getByRole('button', { name: /Reinstate this booking/i }).click();
		await page.locator('textarea[name="reason"], input[name="reason"]').fill('E2E: guest called back');
		await page.getByRole('button', { name: /^Reinstate$/i }).click();
		await expect(page.getByText(/Booking reinstated/i)).toBeVisible();
		// It is unpaid, so staff are told the clock is running and how to stop it.
		await expect(page.getByText(/releases itself again in \d+ minutes/i)).toBeVisible();

		// The regression: a guest opening their email link used to undo this within seconds.
		await page.goto(`/${SLUG}`);
		await page.goto(detail);
		await expect(page.getByText(/Cancelled/i)).toHaveCount(0);
		await expect(page.getByText(/Awaiting payment|Pending payment/i).first()).toBeVisible();

		// ...but the clock really did restart: left unpaid, it releases itself once more.
		await page.waitForTimeout(TTL_MS + 90_000);
		await page.goto(`/${SLUG}`);
		await page.goto(detail);
		await expect(page.getByText(/Cancelled/i).first()).toBeVisible();
	});
});

/**
 * The sibling fix — `runNoShowAutoflag` no longer re-flags a booking a human reinstated out
 * of `no_show` — cannot be driven from the UI: the job is on an hourly pg-boss cron and the
 * app has no "run job now" control. To check it by hand: take a booking whose check-in is in
 * the past, mark it no-show, reinstate it, then invoke `runNoShowAutoflag()` (or wait for the
 * hourly tick) and confirm the booking is still `confirmed`.
 */
