import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';

const dining = `/${SLUG}/management/dining`;

test.describe('Dining · Cashflow tab', () => {
	test.beforeEach(async ({ page }) => {
		await staffLogin(page);
	});

	test('sits beside Sales and shows the money summary', async ({ page }) => {
		await page.goto(`${dining}/sales`);
		await expect(page.getByRole('link', { name: 'Cashflow' })).toBeVisible();
		await page.getByRole('link', { name: 'Cashflow' }).click();
		await expect(page).toHaveURL(/\/dining\/cashflow/);
		for (const label of ['Money in', 'Refunds out', 'Net', 'Online money awaiting payout']) {
			await expect(page.getByText(label, { exact: true })).toBeVisible();
		}
		await expect(page.getByText('Undeposited Funds').first()).toBeVisible();
	});

	test('date range, CSV and the Sales cross-link work', async ({ page }) => {
		await page.goto(`${dining}/cashflow?from=2020-01-01&to=2020-01-02`);
		await expect(page.getByText(/No dining money moved/)).toBeVisible();
		const csv = await page.request.get(`${dining}/cashflow/csv?from=2020-01-01&to=2020-01-02`);
		expect(csv.ok()).toBeTruthy();
		expect(await csv.text()).toContain('Dining cashflow');

		await page.goto(`${dining}/sales?from=2020-01-01&to=2020-01-02`);
		await expect(page.getByText(/No paid orders/)).toBeVisible();
	});

	test('print sheets and CSVs carry the same figures as the page', async ({ page }) => {
		const range = 'from=2000-01-01&to=2099-12-31';
		for (const [tab, print, title, sections] of [
			['sales', 'dining-sales', 'Dining sales report', ['Sales by day', 'Sales by payment method', 'Sales by station', 'Top dishes']],
			['cashflow', 'dining-cashflow', 'Dining cashflow report', ['Cashflow by day', 'Where the money sits', 'Movements']]
		] as const) {
			// The tab's Print button opens the sheet for the same range.
			await page.goto(`${dining}/${tab}?${range}`);
			await expect(page.getByRole('link', { name: 'Print' })).toHaveAttribute('href', new RegExp(`/print/${print}\?`));

			await page.goto(`/${SLUG}/print/${print}?${range}`);
			await expect(page.getByText(title, { exact: true })).toBeVisible();
			await expect(page.getByText('Basis of preparation')).toBeVisible();
			const sheet = await page.locator('.rs-page').innerText();
			for (const name of ['PREPARED BY', 'REVIEWED BY', 'APPROVED BY']) expect(sheet.toUpperCase()).toContain(name);
			for (const sec of sections) expect(sheet.toUpperCase()).toContain(sec.toUpperCase());

			// The CSV is built from the same document: every section title is in it too.
			const csv = await (await page.request.get(`${dining}/${tab}/csv?${range}`)).text();
			expect(csv.startsWith('﻿')).toBeTruthy();
			for (const sec of sections) expect(csv).toContain(sec);
			// ...and so are the grand totals printed on the sheet.
			const money = (sheet.match(/PHP ([d,]+.d{2})/) ?? [])[1];
			if (money) expect(csv).toContain(money.replace(/,/g, ''));
		}
	});

	test('a week of Sales shows the trend chart and online orders are labelled', async ({ page }) => {
		await page.goto(`${dining}/sales?from=2000-01-01&to=2099-12-31`);
		// Only asserts the chart when there are sales in range; an empty hotel just shows the empty state.
		const hasSales = await page.getByText('Sales, VAT included').isVisible().catch(() => false);
		if (hasSales) {
			await expect(page.getByRole('img', { name: /Daily dining sales/ })).toBeVisible();
			await expect(page.getByText('paymongo', { exact: true })).toHaveCount(0);
		}
	});

	// Writes a real ₱0.01 payout (Undeposited → bank) when money is waiting, so run it on dev data only.
	test('recording a payout moves money out of "awaiting payout"', async ({ page }) => {
		await page.goto(`${dining}/cashflow?from=2000-01-01&to=2099-12-31`);
		const payout = page.getByRole('button', { name: 'Record PayMongo payout' });
		test.skip(!(await payout.isVisible().catch(() => false)), 'Nothing is waiting for payout on this hotel.');
		const figure = page.locator('dt', { hasText: 'Online money awaiting payout' }).locator('xpath=following-sibling::dd');
		const before = await figure.innerText();
		await payout.click();
		await page.locator('#payAmt').fill('0.01');
		await page.getByRole('button', { name: 'Record payout', exact: true }).click();
		await expect(page.getByText('Payout recorded.')).toBeVisible();
		await expect(figure).not.toHaveText(before);
	});
});
