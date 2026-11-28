import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import { closeDb, hotelIdFor, sql } from './db';

/**
 * Expenses: the receipt input takes several photos; all of them show on the details page.
 * Prerequisites: at least one expense category. Leaves one small draft expense behind.
 */

test.afterAll(closeDb);

// 1×1 transparent PNG.
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

test('an expense keeps several receipt photos', async ({ page }) => {
	const hotelId = await hotelIdFor(SLUG);
	test.skip(!hotelId, `No hotel with slug "${SLUG}". Set E2E_HOTEL_SLUG.`);
	const desc = `E2E photos ${Date.now().toString().slice(-7)}`;

	await staffLogin(page);
	await page.goto(`/${SLUG}/management/finance/expenses`, { waitUntil: 'networkidle' });
	await page.getByRole('button', { name: 'New expense' }).click();
	const form = page.locator('form[action="?/create"]');
	await form.locator('select[name="source"]').selectOption('hotel');
	await form.locator('input[name="description"]').fill(desc);
	await form.locator('input[name="gross"]').fill('5');
	const input = form.locator('input[name="attachment"]');
	await input.setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: PNG }]);
	await expect(form.getByRole('img', { name: /^Selected receipt/ })).toHaveCount(1);
	// A second pick adds to the first instead of replacing it.
	await input.setInputFiles([
		{ name: 'b.png', mimeType: 'image/png', buffer: PNG },
		{ name: 'c.png', mimeType: 'image/png', buffer: PNG }
	]);
	await expect(form.getByRole('img', { name: /^Selected receipt/ })).toHaveCount(3);
	await form.getByRole('button', { name: 'Remove photo 3' }).click();
	await expect(form.getByRole('img', { name: /^Selected receipt/ })).toHaveCount(2);
	await form.getByRole('button', { name: 'Save expense' }).click();

	const row = page.getByRole('row').filter({ hasText: desc });
	await expect(row.getByRole('link', { name: 'receipts (2)' })).toBeVisible();
	const [e] = await sql<{ n: number }[]>`
		select cardinality(attachment_urls)::int as n from expenses
		where hotel_id = ${hotelId} and description = ${desc}`;
	expect(e?.n).toBe(2);

	await row.getByRole('link', { name: 'receipts (2)' }).click();
	await expect(page.getByRole('img', { name: /^Receipt \d for / })).toHaveCount(2);
});
