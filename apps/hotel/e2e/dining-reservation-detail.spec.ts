import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import { closeDb, hotelIdFor, sql } from './db';

/**
 * A table reservation opens into its own page, like a room booking transaction: the booking, the
 * dishes pre-ordered, the payments, receipts and a money summary.
 *
 * Prerequisites: at least one reservation with a paid pre-order (book one online and pay it).
 */

test.afterAll(closeDb);

test('a reservation with a paid pre-order shows its dishes and payment', async ({ page }) => {
	const hotelId = await hotelIdFor(SLUG);
	test.skip(!hotelId, `No hotel with slug "${SLUG}". Set E2E_HOTEL_SLUG.`);
	const [r] = await sql<{ code: string; guest: string; total: string; dish: string }[]>`
		select r.code, r.guest_name as guest, o.total_centavos as total,
			(select i.name from dining_order_items i where i.order_id = o.id order by i.sort_order limit 1) as dish
		from dining_reservations r
		join dining_orders o on o.reservation_id = r.id and o.order_type = 'pre_order' and o.payment_status = 'paid'
		where r.hotel_id = ${hotelId}
		order by r.created_at desc limit 1`;
	test.skip(!r, 'No reservation with a paid pre-order yet.');

	await staffLogin(page);
	await page.goto(`/${SLUG}/management/dining/reservations/${r!.code}`);
	await expect(page.getByRole('heading', { level: 1, name: r!.guest })).toBeVisible();
	await expect(page.getByText(r!.code, { exact: true })).toBeVisible();
	await expect(page.getByRole('cell', { name: r!.dish }).first()).toBeVisible();
	const total = `₱${(Number(r!.total) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	// Ordered and Paid both read the pre-order's total.
	await expect(page.locator('aside').getByText(total)).toHaveCount(2);
	await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
	await expect(page.getByRole('link', { name: '← Reservations' })).toBeVisible();
	await page.screenshot({ path: 'test-results/dining-reservation-detail.png', fullPage: true });

	const missing = await page.goto(`/${SLUG}/management/dining/reservations/TB-NOPE`);
	expect(missing?.status()).toBe(404);
});
