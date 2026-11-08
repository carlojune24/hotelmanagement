import { expect, test, type Page } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import { closeDb, hotelIdFor, movementForSource, sql } from './db';
import { computeDiningDiscount } from '../src/lib/dining-discount';

/**
 * Dining discounts: the rates a manager sets in Dining → Settings, and what the cashier takes off
 * when settling a table. Senior / PWD covers only the qualifying share (here 1 of 4 diners): that
 * share's VAT is removed and the % comes off its VAT-exclusive amount. The money trail (order row and
 * cash movement) must carry the discounted amount, to the centavo of `computeDiningDiscount`.
 *
 * Prerequisites: a dining venue with an available dish and at least one table, and a bank / e-wallet
 * account for non-cash payments (Finance settings).
 */

const orders = `/${SLUG}/management/dining/orders`;
let hotelId: string | null = null;

test.beforeAll(async () => {
	hotelId = await hotelIdFor(SLUG);
});
test.afterAll(closeDb);

async function setRates(page: Page, scPwd: string, staff: string) {
	await page.goto(`/${SLUG}/management/dining/settings`);
	const form = page.locator('form[action="?/updateDiscounts"]');
	await form.getByLabel('Senior Citizen / PWD discount (%)').fill(scPwd);
	await form.getByLabel('Staff discount (%)').fill(staff);
	await form.getByRole('button', { name: 'Save discounts' }).click();
	await expect
		.poll(async () => (await sql<{ d: unknown }[]>`select config->'dining' as d from hotels where id = ${hotelId}`)[0]?.d, { timeout: 15_000 })
		.toMatchObject({ scPwdDiscountBps: Math.round(Number(scPwd) * 100), staffDiscountBps: Math.round(Number(staff) * 100) });
}

/** Places a dine-in order on the first table and returns its row (unpaid, on an open check). */
async function placeTableOrder(page: Page) {
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
	await cart.getByText('Dine-in', { exact: true }).click();
	const tablePicker = cart.getByRole('combobox', { name: 'Table' });
	test.skip((await tablePicker.count()) === 0, 'This venue has no tables.');
	await tablePicker.click();
	await page.getByRole('option').nth(1).click(); // 0 is "No table"
	const before = new Date();
	await cart.getByRole('button', { name: 'Place order', exact: true }).click();

	await expect
		.poll(async () => (await sql`select id from dining_orders where hotel_id = ${hotelId} and check_id is not null and created_at >= ${before}`).length, { timeout: 20_000 })
		.toBeGreaterThan(0);
	const [o] = await sql<{ id: string; check_id: string; table_label: string; total_centavos: string; vat_centavos: string }[]>`
		select id, check_id, table_label, total_centavos, vat_centavos from dining_orders
		where hotel_id = ${hotelId} and check_id is not null and created_at >= ${before}
		order by created_at desc limit 1`;
	return { ...o!, total: Number(o!.total_centavos), vat: Number(o!.vat_centavos) };
}

test('managers set the dining discount rates, and Senior / PWD comes off only the qualifying share', async ({ page }) => {
	test.skip(!hotelId, `No hotel with slug "${SLUG}". Set E2E_HOTEL_SLUG.`);
	await staffLogin(page);
	await setRates(page, '20', '10');

	const order = await placeTableOrder(page);
	const ref = `SC-E2E-${Date.now().toString().slice(-6)}`;

	await page.goto(orders);
	const card = page.locator('div', { has: page.getByText(`Table ${order.table_label}`, { exact: true }) })
		.filter({ has: page.getByRole('button', { name: 'Settle & close' }) })
		.last();
	await card.getByRole('button', { name: 'Settle & close' }).click();

	const dlg = page.getByRole('dialog');
	await dlg.getByRole('radio', { name: 'GCash' }).click();
	await expect(dlg.getByRole('radio', { name: 'Staff 10%' })).toBeVisible();
	await dlg.getByRole('radio', { name: /Senior \/ PWD 20%/ }).click();
	const record = dlg.getByRole('button', { name: /^Record ₱/ });
	await expect(record, 'name, ID and diners are required for SC/PWD').toBeDisabled();
	await dlg.getByLabel('Name', { exact: true }).fill('Lola Test');
	await dlg.getByLabel('OSCA / PWD ID no.').fill('OSCA-0001');
	await dlg.getByLabel('Diners in all').fill('4');
	await dlg.getByLabel('Reference no.').fill(ref);
	await expect(record).toBeEnabled();
	await record.click();

	const want = computeDiningDiscount({ totalCentavos: order.total, vatCentavos: order.vat }, 'sc_pwd', 2000, 1, 4);
	await expect
		.poll(async () => (await sql<{ s: string }[]>`select payment_status as s from dining_orders where id = ${order.id}`)[0]?.s, { timeout: 20_000 })
		.toBe('paid');
	const [row] = await sql<Record<string, unknown>[]>`
		select total_centavos, vat_centavos, discount_kind, discount_bps, discount_centavos,
		       discount_vat_removed_centavos, discount_claimants, discount_diners
		from dining_orders where id = ${order.id}`;
	expect(row).toMatchObject({
		discount_kind: 'sc_pwd',
		discount_bps: 2000,
		discount_diners: 4,
		discount_claimants: [{ name: 'Lola Test', idNumber: 'OSCA-0001' }]
	});
	expect(Number(row!.total_centavos)).toBe(want.netCentavos);
	expect(Number(row!.vat_centavos)).toBe(want.netVatCentavos);
	expect(Number(row!.discount_centavos)).toBe(want.discountCentavos);
	expect(Number(row!.discount_vat_removed_centavos)).toBe(want.vatRemovedCentavos);
	// Only 1 of 4 diners qualifies, so most of the VAT stays.
	expect(want.netVatCentavos).toBeGreaterThan(0);
	expect(order.total - want.netCentavos).toBe(want.discountCentavos + want.vatRemovedCentavos);

	const movement = await movementForSource('dining_order', order.id);
	expect(movement?.amountCentavos, 'the ledger carries what the guest actually paid').toBe(want.netCentavos);
});

