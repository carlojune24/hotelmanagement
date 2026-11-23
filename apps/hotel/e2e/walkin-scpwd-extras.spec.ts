import { expect, test } from 'playwright/test';
import { SLUG, staffLogin, uniqueGuest } from './helpers';
import { sql } from './db';

/**
 * The walk-in sheet's Senior Citizen / PWD discount and Extras, applied at booking time so the guest
 * pays the lower amount (no refund afterwards). Money is read back from the dev database.
 *
 *   E2E_HOTEL_SLUG=mmhotel pnpm exec playwright test e2e/walkin-scpwd-extras.spec.ts
 *
 * Pays by GCash with a reference so no open cashier shift is needed. Leaves its bookings behind
 * (guest names start "E2E Guest").
 */

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const RUN = Date.now().toString().slice(-6);

async function openWalkInWithRoom(page: import('playwright/test').Page, startOffset: number) {
	await page.goto(`/${SLUG}/management/front-desk`);
	await page.waitForLoadState('networkidle'); // the sheet's buttons do nothing before hydration
	await page.getByRole('button', { name: 'Walk-in', exact: true }).click();
	const sheet = page.locator('[data-slot="sheet-content"]');
	await expect(sheet.getByText('Walk-in booking')).toBeVisible();
	await sheet.locator('input[name="checkIn"]').fill(day(startOffset));
	await sheet.locator('input[name="checkOut"]').fill(day(startOffset + 1));
	await sheet.getByRole('button', { name: 'Check availability' }).click();
	const add = sheet.getByRole('button', { name: 'Add', exact: true });
	await expect(add.first()).toBeVisible();
	await add.first().click();
	await expect(sheet.getByRole('button', { name: 'OTA booking' })).toBeVisible();
	return sheet;
}

async function fillGuestAndPay(sheet: ReturnType<import('playwright/test').Page['locator']>, name: string) {
	const guest = uniqueGuest();
	await sheet.locator('#wiFullName').fill(name);
	await sheet.locator('#wiEmail').fill(guest.email);
	await sheet.locator('#wiPhone').fill(guest.phone);
	await sheet.locator('select[name="method"]').selectOption('gcash');
	await sheet.locator('input[name="referenceNo"]').fill(`E2E-${RUN}`);
}

test.describe('walk-in · SC/PWD + extras', () => {
	test.beforeEach(async ({ page }) => {
		await staffLogin(page);
	});

	test('the sheet is wider than before', async ({ page }) => {
		const sheet = await openWalkInWithRoom(page, 120);
		const box = await sheet.boundingBox();
		expect(box!.width).toBeGreaterThan(520); // was max-w-md (448px)
	});

	test('SC/PWD at booking: the summary shows VAT removed + the discount, and the guest pays the net', async ({ page }) => {
		const sheet = await openWalkInWithRoom(page, 121);
		const name = `E2E Guest SC ${RUN}`;
		await fillGuestAndPay(sheet, name);

		await sheet.getByLabel('Senior Citizen / PWD discount').check();
		const create = sheet.getByRole('button', { name: 'Create booking & record payment' });
		// No ID number yet: cannot submit.
		await expect(sheet.getByText('Enter the OSCA / PWD ID number')).toBeVisible();
		await expect(create).toBeDisabled();
		await sheet.locator('#scPwdIdNo').fill('OSCA-12345');

		await expect(sheet.getByText('VAT removed (exempt sale)')).toBeVisible();
		await expect(sheet.getByText(/Senior Citizen discount \(\d+(\.\d+)?%\)/)).toBeVisible();
		const dueText = await sheet.getByLabel('Price summary').getByText('Total due now').locator('xpath=following-sibling::dd').innerText();
		const due = Math.round(parseFloat(dueText.replace(/[^\d.]/g, '')) * 100);

		await create.click();
		await page.waitForURL(/\/management\/transactions\//);
		const orderId = page.url().match(/transactions\/([0-9a-f-]{36})/)![1]!;

		const claim = (await sql`select d.claimant_type, d.id_number, d.discount_bps::int bps from sc_pwd_discounts d join bookings b on b.id = d.booking_id where b.order_id = ${orderId} and d.reversed_at is null`)[0];
		expect(claim?.claimant_type).toBe('senior_citizen');
		expect(claim?.id_number).toBe('OSCA-12345');
		const paid = (await sql`select coalesce(sum(amount_centavos),0)::int p from payments where order_id = ${orderId} and status = 'paid'`)[0]!.p as number;
		expect(paid).toBe(due); // the discounted amount, not the full rate
		const refunds = (await sql`select count(*)::int n from payments where order_id = ${orderId} and amount_centavos < 0`)[0]!.n as number;
		expect(refunds).toBe(0);
	});

	test('an extra breakfast is added to the folio and paid with the booking', async ({ page }) => {
		const sheet = await openWalkInWithRoom(page, 122);
		await fillGuestAndPay(sheet, `E2E Guest Extra ${RUN}`);

		await sheet.locator('#wiExtraName').fill('Extra breakfast');
		await sheet.locator('#wiExtraQty').fill('2');
		await sheet.locator('#wiExtraPrice').fill('350');
		await sheet.getByRole('button', { name: 'Add', exact: true }).last().click();
		await expect(sheet.getByText('Extra breakfast')).toBeVisible();
		await expect(sheet.getByLabel('Price summary').getByText('Extras')).toBeVisible();

		await sheet.getByRole('button', { name: 'Create booking & record payment' }).click();
		await page.waitForURL(/\/management\/transactions\//);
		const orderId = page.url().match(/transactions\/([0-9a-f-]{36})/)![1]!;

		const line = (await sql`select c.quantity::int q, c.total_centavos::int t from folio_charges c join folios f on f.id = c.folio_id join bookings b on b.id = f.booking_id where b.order_id = ${orderId} and c.description = 'Extra breakfast'`)[0];
		expect(line).toEqual({ q: 2, t: 70_000 });
		const bal = (await sql`select (select coalesce(sum(c.total_centavos),0) from folio_charges c join folios f on f.id = c.folio_id join bookings b on b.id = f.booking_id where b.order_id = ${orderId} and c.voided_at is null) - (select coalesce(sum(amount_centavos),0) from payments where order_id = ${orderId} and status = 'paid' and voided_at is null) as bal`)[0]!.bal;
		expect(Number(bal)).toBe(0); // paid in full at the desk
	});
});
