import { expect, test } from 'playwright/test';
import { futureDate, SLUG, staffLogin } from './helpers';
import { closeDb, hotelIdFor, sql } from './db';

/**
 * Expenses: a picked expense date survives the staff layout's 30 s badge refresh (it used to snap
 * back to today), and every expense opens a full-details page.
 *
 * Prerequisites: at least one expense category. Leaves one small draft expense behind.
 */

test.afterAll(closeDb);

test('picked expense date is kept after the background refresh', async ({ page }) => {
	const hotelId = await hotelIdFor(SLUG);
	test.skip(!hotelId, `No hotel with slug "${SLUG}". Set E2E_HOTEL_SLUG.`);

	const n = Date.now().toString().slice(-7);
	const desc = `E2E dated ${n}`;
	const picked = futureDate(-10);

	await staffLogin(page);
	// Fake timers so the layout's 30 s setInterval can be fired on demand.
	await page.clock.install();
	await page.goto(`/${SLUG}/management/finance/expenses`, { waitUntil: 'networkidle' });

	await page.getByRole('button', { name: 'New expense' }).click();
	const form = page.locator('form[action="?/create"]');
	await form.locator('input[name="expenseDate"]').fill(picked);
	await form.locator('select[name="source"]').selectOption('hotel');
	await form.locator('input[name="description"]').fill(desc);
	await form.locator('input[name="gross"]').fill('5');

	// The badge refresh fires and reloads the page data; the date must not reset to today.
	await page.clock.runFor(31_000);
	await page.waitForLoadState('networkidle');
	await expect(form.locator('input[name="expenseDate"]')).toHaveValue(picked);

	await form.getByRole('button', { name: 'Save expense' }).click();
	const row = page.getByRole('row').filter({ hasText: desc });
	await expect(row).toContainText(picked);
	const [e] = await sql<{ d: string }[]>`
		select expense_date::text as d from expenses where hotel_id = ${hotelId} and description = ${desc}`;
	expect(e?.d).toBe(picked);

	// The row opens the expense's full-details page.
	await row.getByRole('link', { name: 'Details' }).click();
	await expect(page).toHaveURL(/\/finance\/expenses\/[0-9a-f-]{36}$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(desc);
	await expect(page.getByText('Pay vendor')).toBeVisible();
	await expect(page.getByText('₱5.00').first()).toBeVisible();
	await expect(page.getByText('No receipt photo attached.')).toBeVisible();
});
