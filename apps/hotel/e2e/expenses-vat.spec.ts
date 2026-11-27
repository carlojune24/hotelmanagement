import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import { closeDb, hotelIdFor, sql } from './db';

/**
 * Expenses form: the amount is always the receipt total; the VAT box only splits out the VAT
 * already inside it (gross × 12/112), and withholding tax is held back from the vendor at Pay.
 *
 * Prerequisites: a cash account holding at least ₱55 and an expense category. Leaves one small
 * paid expense behind (₱55 out of that account).
 */

test.afterAll(closeDb);

test('VAT box splits input VAT, withholding is held back at Pay', async ({ page }) => {
	const hotelId = await hotelIdFor(SLUG);
	test.skip(!hotelId, `No hotel with slug "${SLUG}". Set E2E_HOTEL_SLUG.`);
	const [acct] = await sql<{ id: string }[]>`
		select id from cash_accounts
		where hotel_id = ${hotelId} and is_active and current_balance_centavos >= 5500
		order by current_balance_centavos desc limit 1`;
	test.skip(!acct, 'No active cash account holding ₱55.');

	const desc = `E2E VAT ${Date.now().toString().slice(-7)}`;
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/finance/expenses`, { waitUntil: 'networkidle' });
	await page.getByRole('button', { name: 'New expense' }).click();

	const form = page.locator('form[action="?/create"]');
	await form.locator('select[name="source"]').selectOption('hotel');
	await form.locator('input[name="description"]').fill(desc);
	await form.locator('input[name="gross"]').fill('56');
	const preview = form.locator('p[aria-live="polite"]');
	await expect(preview).toContainText('Input VAT ₱0.00');

	const [h] = await sql<{ bps: number }[]>`select vat_rate_bps as bps from hotels where id = ${hotelId}`;
	const vatBox = form.getByLabel(/Receipt includes .*VAT/);
	// Shape of the assertions below assumes 12% (56 → 6 VAT) or a non-VAT hotel (no box at all).
	const vat = h!.bps === 1200 ? '₱6.00' : '—';
	if (h!.bps > 0) {
		test.skip(h!.bps !== 1200, 'Spec amounts assume a 12% VAT rate.');
		await vatBox.check();
		await expect(preview).toContainText('Input VAT ₱6.00');
		await expect(preview).toContainText('Net of VAT ₱50.00');
	} else {
		await expect(vatBox).toHaveCount(0);
		await expect(form).toContainText("isn't VAT-registered");
	}

	// Withholding equal to the whole receipt is refused.
	await form.locator('input[name="withholdingTax"]').fill('56');
	await form.getByRole('button', { name: 'Save expense' }).click();
	await expect(page.getByText('Withholding tax must be less than the amount on the receipt.')).toBeVisible();

	await form.locator('input[name="withholdingTax"]').fill('1');
	await expect(preview).toContainText('Pay vendor ₱55.00');
	await form.getByRole('button', { name: 'Save expense' }).click();

	const row = page.getByRole('row').filter({ hasText: desc });
	await expect(row).toContainText('₱56.00');
	await expect(row.getByRole('cell').nth(5)).toHaveText(vat);

	await row.getByRole('button', { name: 'Pay', exact: true }).click();
	const payForm = page.locator('form[action="?/pay"]');
	await payForm.locator('select[name="paidFromAccountId"]').selectOption(acct!.id);
	await expect(payForm).toContainText('₱1.00 withheld');
	await payForm.getByRole('button', { name: 'Confirm payment (₱55.00)' }).click();
	await expect(row).toContainText('paid');

	const [mv] = await sql<{ amount: number }[]>`
		select m.amount_centavos::int as amount from cash_movements m
		join expenses e on e.id::text = m.source_id::text
		where m.source_type = 'expense' and e.hotel_id = ${hotelId} and e.description = ${desc}`;
	expect(mv?.amount).toBe(5500);
});
