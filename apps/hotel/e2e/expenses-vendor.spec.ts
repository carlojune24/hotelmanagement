import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import { closeDb, hotelIdFor, sql } from './db';

/**
 * Expenses vendor field: a typed name that isn't a saved vendor is kept on that expense only
 * (never added to the vendor list) and names the payee in the cash trail; a saved vendor's
 * name links to the vendor record.
 *
 * Prerequisites: a cash account holding at least ₱20. Leaves two small expenses behind
 * (one paid, ₱10 out of that account).
 */

test.afterAll(closeDb);

/** `pick` chooses the vendor from the dropdown; otherwise the name is typed as a one-off. */
async function addExpense(page: import('playwright/test').Page, vendor: string, desc: string, pick = false) {
	await page.getByRole('button', { name: 'New expense' }).click();
	const form = page.locator('form[action="?/create"]');
	await form.locator('select[name="source"]').selectOption('hotel');
	const field = form.getByRole('combobox', { name: 'Vendor' });
	if (pick) {
		await form.getByRole('button', { name: 'Show saved vendors' }).click();
		await page.screenshot({ path: 'test-results/expenses-vendor-dropdown.png' });
		await page.getByRole('option', { name: vendor, exact: true }).click();
	} else {
		await field.pressSequentially(vendor);
		await expect(page.getByText(`Use “${vendor}” as a one-off vendor`)).toBeVisible();
		await field.press('Escape');
	}
	await form.locator('input[name="description"]').fill(desc);
	await form.locator('input[name="gross"]').fill('10');
	await form.getByRole('button', { name: 'Save expense' }).click();
	const row = page.getByRole('row').filter({ hasText: desc });
	await expect(row).toContainText(vendor);
	return row;
}

test('typed vendor stays on the expense; saved vendor links', async ({ page }) => {
	const hotelId = await hotelIdFor(SLUG);
	test.skip(!hotelId, `No hotel with slug "${SLUG}". Set E2E_HOTEL_SLUG.`);
	const [acct] = await sql<{ id: string }[]>`
		select id from cash_accounts
		where hotel_id = ${hotelId} and is_active and current_balance_centavos >= 2000
		order by current_balance_centavos desc limit 1`;
	test.skip(!acct, 'No active cash account holding ₱20.');

	const n = Date.now().toString().slice(-7);
	const oneOff = `E2E Plumber ${n}`;
	const [{ count: vendorsBefore }] = await sql<{ count: number }[]>`
		select count(*)::int as count from vendors where hotel_id = ${hotelId}`;

	await staffLogin(page);
	await page.goto(`/${SLUG}/management/finance/expenses`, { waitUntil: 'networkidle' });

	const row = await addExpense(page, oneOff, `E2E one-off ${n}`);
	const [e] = await sql<{ vendor_id: string | null; vendor_name: string | null }[]>`
		select vendor_id, vendor_name from expenses where hotel_id = ${hotelId} and description = ${`E2E one-off ${n}`}`;
	expect(e).toEqual({ vendor_id: null, vendor_name: oneOff });
	const [{ count: vendorsAfter }] = await sql<{ count: number }[]>`
		select count(*)::int as count from vendors where hotel_id = ${hotelId}`;
	expect(vendorsAfter).toBe(vendorsBefore);

	await row.getByRole('button', { name: 'Pay', exact: true }).click();
	const payForm = page.locator('form[action="?/pay"]');
	await payForm.locator('select[name="paidFromAccountId"]').selectOption(acct!.id);
	await payForm.getByRole('button', { name: /Confirm payment/ }).click();
	await expect(row).toContainText('paid');
	const [mv] = await sql<{ name: string | null }[]>`
		select m.counterparty_name as name from cash_movements m
		join expenses x on x.id::text = m.source_id::text
		where m.source_type = 'expense' and x.hotel_id = ${hotelId} and x.description = ${`E2E one-off ${n}`}`;
	expect(mv?.name).toBe(oneOff);

	// A saved vendor picked from the dropdown links to the record.
	const [saved] = await sql<{ id: string; name: string }[]>`
		select id, name from vendors where hotel_id = ${hotelId} and is_active and deleted_at is null limit 1`;
	if (saved) {
		await addExpense(page, saved.name, `E2E saved ${n}`, true);
		const [s] = await sql<{ vendor_id: string | null; vendor_name: string | null }[]>`
			select vendor_id, vendor_name from expenses where hotel_id = ${hotelId} and description = ${`E2E saved ${n}`}`;
		expect(s).toEqual({ vendor_id: saved.id, vendor_name: null });
	}
});
