import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import { closeDb, hotelIdFor, sql } from './db';
import { computeDiningDiscount } from '../src/lib/dining-discount';

/**
 * A Senior / PWD guest shows their ID after the bill was paid in full: a manager applies the discount
 * on the paid order, the difference is refunded, and the receipt is issued again. The money trail:
 * the order is re-priced exactly as at the till, a `discount_refund` row and a `refund` cash movement
 * carry the difference, and the old receipt is cancelled (serial kept) with a new one in force.
 *
 * Signs in as the seeded staff account, which must be a manager (dining:manage or hotel:admin).
 * Prerequisites: a venue with an available dish, Senior / PWD above 0% in Dining settings, and a bank /
 * e-wallet account for GCash (Finance settings).
 */

let hotelId: string | null = null;
test.beforeAll(async () => {
	hotelId = await hotelIdFor(SLUG);
});
test.afterAll(closeDb);

test('Senior / PWD after payment re-prices the order, refunds the difference and re-issues the receipt', async ({ page }) => {
	test.skip(!hotelId, `No hotel with slug "${SLUG}". Set E2E_HOTEL_SLUG.`);
	await staffLogin(page);
	const orders = `/${SLUG}/management/dining/orders`;

	// A takeaway paid in full by GCash.
	await page.goto(orders);
	const menu = page.locator('section[aria-label="Menu"]');
	await expect(async () => {
		await page.getByRole('button', { name: 'New order' }).click();
		await expect(menu).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 30_000 });
	const dish = menu.locator('li > button:not([disabled])').first();
	test.skip((await dish.count()) === 0, 'This venue has no available dish to sell.');
	await dish.click();
	const addToOrder = page.getByRole('button', { name: 'Add to order' });
	if (await addToOrder.isVisible().catch(() => false)) await addToOrder.click();
	const cart = page.locator('aside[aria-label="This order"]');
	await cart.getByText('Takeaway', { exact: true }).click();
	const before = new Date();
	await cart.getByRole('button', { name: 'Place & pay' }).click();
	const pay = page.getByRole('dialog');
	await pay.getByRole('radio', { name: 'GCash' }).click();
	await pay.getByLabel('Reference no.').fill(`DAP-${Date.now().toString().slice(-6)}`);
	await pay.getByRole('button', { name: /^Record ₱/ }).click();
	await expect
		.poll(async () => (await sql`select id from dining_orders where hotel_id = ${hotelId} and created_at >= ${before} and payment_status = 'paid'`).length, { timeout: 20_000 })
		.toBeGreaterThan(0);
	const [o] = await sql<{ id: string; code: string; total: string; vat: string }[]>`
		select id, code, total_centavos as total, vat_centavos as vat from dining_orders
		where hotel_id = ${hotelId} and created_at >= ${before} order by created_at desc limit 1`;
	const receiptsBefore = await sql<{ n: number }[]>`select count(*)::int as n from documents where dining_order_id = ${o!.id} and status = 'issued'`;
	await page.getByRole('button', { name: 'Done' }).click();

	// The manager opens it and applies Senior / PWD for 1 of 1 diner, refunding by GCash.
	await page.goto(orders);
	await page.getByRole('button', { name: new RegExp(`order ${o!.code}.*Open details`) }).click();
	await page.getByRole('button', { name: 'Apply Senior / PWD' }).click();
	const dlg = page.getByRole('dialog', { name: 'Senior / PWD after payment' });
	await dlg.getByLabel('Diners at the table').fill('1');
	await dlg.getByLabel('Name', { exact: true }).fill('Lola After');
	await dlg.getByLabel('OSCA ID no.').fill('OSCA-AFTER');
	await dlg.getByLabel('Refund by').click();
	await page.getByRole('option', { name: 'GCash' }).click();
	const ref = `DAPR-${Date.now().toString().slice(-6)}`;
	await dlg.getByLabel(/Reference no/).fill(ref);
	await dlg.getByRole('button', { name: /^Refund ₱/ }).click();
	await expect(dlg.getByText(/now totals/)).toBeVisible({ timeout: 20_000 });

	const [after] = await sql<{ total: string; kind: string; late: string | null }[]>`
		select total_centavos as total, discount_kind as kind, discount_business_date::text as late from dining_orders where id = ${o!.id}`;
	expect(after!.kind).toBe('sc_pwd');
	expect(after!.late, 'dated the day it was given').not.toBeNull();
	// Re-priced with the till's own math, at the rate snapshotted on the order.
	const [bps] = await sql<{ b: number }[]>`select discount_bps as b from dining_orders where id = ${o!.id}`;
	const expected = computeDiningDiscount({ totalCentavos: Number(o!.total), vatCentavos: Number(o!.vat) }, 'sc_pwd', bps!.b, 1, 1);
	expect(Number(after!.total)).toBe(expected.netCentavos);

	const [back] = await sql<{ amount: string; movement: string }[]>`
		select p.amount_centavos as amount, m.amount_centavos as movement
		from dining_payments p join cash_movements m on m.id = p.cash_movement_id
		where p.order_id = ${o!.id} and p.kind = 'discount_refund' and m.category = 'refund' and m.direction = 'out'`;
	expect(Number(back!.amount)).toBe(Number(o!.total) - Number(after!.total));
	expect(Number(back!.movement)).toBe(Number(back!.amount));

	if (receiptsBefore[0]!.n > 0) {
		const docs = await sql<{ status: string }[]>`select status from documents where dining_order_id = ${o!.id} and type = 'official_receipt'`;
		expect(docs.filter((d) => d.status === 'cancelled').length).toBe(1);
		expect(docs.filter((d) => d.status === 'issued').length).toBe(1);
	}

	// Paying it back twice is refused: the order already has its discount.
	await page.goto(orders);
	await page.getByRole('button', { name: new RegExp(`order ${o!.code}.*Open details`) }).click();
	await expect(page.getByRole('button', { name: 'Apply Senior / PWD' })).toHaveCount(0);
});
