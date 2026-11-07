import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import { closeDb, hotelIdFor, sql } from './db';

/**
 * Table pre-orders on the Kitchen board. Today's that are not due yet sit under "Pre-orders coming up"
 * (read-only, with their start time); once due, the ticket carries a PRE-ORDER band with the table,
 * the party and a countdown to the table time. The reservation page shows where the kitchen is.
 *
 * Read-only: it presses nothing on the board. Needs a paid pre-order for a reservation today; each
 * part skips when the data for it isn't there.
 */

test.afterAll(closeDb);

test('pre-orders: coming up, then on the board with a band; reservation shows the kitchen state', async ({ page }) => {
	const hotelId = await hotelIdFor(SLUG);
	test.skip(!hotelId, `No hotel with slug "${SLUG}". Set E2E_HOTEL_SLUG.`);
	const rows = await sql<{ code: string; rcode: string; due: boolean }[]>`
		select o.code, r.code as rcode, (now() >= r.starts_at - make_interval(mins => v.prep_minutes)) as due
		from dining_orders o
		join dining_reservations r on r.id = o.reservation_id
		join dining_items v on v.id = o.dining_item_id
		join hotels h on h.id = o.hotel_id
		where o.hotel_id = ${hotelId} and o.order_type = 'pre_order' and o.status in ('new', 'accepted', 'preparing', 'ready')
		  and r.status in ('pending', 'confirmed')
		  and (r.starts_at at time zone h.timezone)::date = (now() at time zone h.timezone)::date`;
	test.skip(rows.length === 0, 'No live pre-order for a table today.');

	await staffLogin(page);
	await page.goto(`/${SLUG}/management/kitchen?view=tickets`, { waitUntil: 'networkidle' });

	const held = rows.find((r) => !r.due);
	if (held) {
		const strip = page.getByRole('region', { name: /Pre-orders coming up/ });
		await expect(strip.getByText(held.code)).toBeVisible();
		await expect(strip.getByText(/Start at/).first()).toBeVisible();
		await expect(strip.getByRole('button', { name: 'Start' })).toHaveCount(0);
	}

	const due = rows.find((r) => r.due);
	if (due) {
		const ticket = page.locator('article', { hasText: due.code });
		await expect(ticket.locator('[data-preorder-band]')).toContainText(/Pre-order/i);
		await expect(ticket.locator('[data-preorder-band]')).toContainText(/Seats/);
		await expect(ticket.getByText('Due', { exact: true })).toBeVisible();
	}

	await page.goto(`/${SLUG}/management/dining/reservations/${rows[0]!.rcode}`);
	await expect(page.locator('[data-kitchen-state]').first()).toContainText(/Not started yet|Cooking|Ready|Served/);
});
