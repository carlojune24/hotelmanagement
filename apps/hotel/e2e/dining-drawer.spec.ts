import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';

/**
 * Dining runs its own till. Until Finance names a dining drawer, dining cash keeps falling back
 * to the hotel's default drawer (the pre-existing behaviour); once it is named, Dining → Orders
 * opens and closes that drawer itself and the front desk's shift is left alone.
 *
 * Needs a second `cash_drawer` account to exist — the spec creates one if Finance has none spare.
 */

const staff = `/${SLUG}/management`;
const orders = `${staff}/dining/orders`;
const DRAWER = 'E2E Dining drawer';

async function ensureDiningDrawer(page: import('playwright/test').Page) {
	await page.goto(`${staff}/finance/accounts`);
	if ((await page.getByText(DRAWER, { exact: true }).count()) === 0) {
		await page.getByRole('button', { name: /Add (cash )?account|New account/ }).first().click();
		await page.locator('input[name="name"]').last().fill(DRAWER);
		await page.locator('select[name="kind"]').last().selectOption('cash_drawer');
		await page.getByRole('button', { name: /Add|Save|Create/ }).last().click();
		await expect(page.getByText(DRAWER, { exact: true })).toBeVisible();
	}
}

async function setDiningDrawer(page: import('playwright/test').Page, value: string) {
	await page.goto(`${staff}/finance/settings`);
	const select = page.locator('select[name="diningDrawerAccountId"]');
	await expect(select).toBeVisible();
	await select.selectOption(value === '' ? '' : { label: value });
	await page.getByRole('button', { name: /Save/ }).first().click();
	await expect(page.getByText(/Finance settings saved/)).toBeVisible();
}

test.describe('Dining · its own cash drawer', () => {
	test.beforeEach(async ({ page }) => {
		await staffLogin(page);
	});

	test('a new drawer gets its own chart-of-accounts leaf', async ({ page }) => {
		await ensureDiningDrawer(page);
		// Sharing the seeded `1010` leaf would merge this till's money into the front desk's line
		// on the balance sheet; each drawer posts to a line of its own, named after it.
		await page.goto(`${staff}/finance/accounts`);
		await page.getByRole('searchbox').or(page.locator('input[type="search"]')).first().fill(DRAWER);
		await expect(page.getByText(DRAWER).first()).toBeVisible();
		await expect(page.getByText('No account matches.')).toHaveCount(0);
	});

	test('the two drawer pickers exclude each other', async ({ page }) => {
		await ensureDiningDrawer(page);
		await setDiningDrawer(page, DRAWER);
		await page.goto(`${staff}/finance/settings`);

		// Whichever till each side holds is not offered by the other, so one drawer can never
		// serve both registers — the clash that silently merges dining's cash into the desk's.
		const front = page.locator('select[name="defaultDrawerAccountId"]');
		const dining = page.locator('select[name="diningDrawerAccountId"]');
		await expect(front.locator('option', { hasText: DRAWER })).toHaveCount(0);
		await expect(dining.locator('option', { hasText: 'Front Desk Drawer' })).toHaveCount(0);
		await expect(dining.locator('option', { hasText: DRAWER })).toHaveCount(1);
	});

	test('with no dining drawer set, Orders points at Finance settings', async ({ page }) => {
		await setDiningDrawer(page, '');
		await page.goto(orders);
		await expect(page.getByRole('link', { name: /Set up the dining drawer/ })).toBeVisible();
	});

	test('opens and closes its drawer from the Orders toolbar', async ({ page }) => {
		await ensureDiningDrawer(page);
		await setDiningDrawer(page, DRAWER);

		await page.goto(orders);
		const float = page.getByLabel('Opening float');
		await expect(float).toBeVisible();
		await float.fill('500');
		await page.getByRole('button', { name: 'Open shift' }).click();

		// The toolbar flips to the open state, naming the drawer and its float.
		await expect(page.getByText(`${DRAWER} open · float ₱500.00`)).toBeVisible();

		// Closing counts the cash; an exact count balances.
		await page.getByRole('button', { name: 'Close shift' }).click();
		await expect(page.getByText(/₱500.00 is expected/)).toBeVisible();
		await page.getByLabel('Counted cash').fill('500');
		await page.getByRole('dialog').getByRole('button', { name: 'Close shift' }).click();
		await expect(page.getByText(/Dining drawer closed — balanced|closed — balanced/)).toBeVisible();
		await expect(page.getByLabel('Opening float')).toBeVisible();
	});

	test("dining's shift is its own — the front desk's drawer is untouched", async ({ page }) => {
		await ensureDiningDrawer(page);
		await setDiningDrawer(page, DRAWER);

		await page.goto(orders);
		await page.getByLabel('Opening float').fill('300');
		await page.getByRole('button', { name: 'Open shift' }).click();
		await expect(page.getByText(`${DRAWER} open`)).toBeVisible();

		// Finance lists it as a shift of its own, on its own drawer.
		await page.goto(`${staff}/finance/shifts`);
		await expect(page.getByText(DRAWER).first()).toBeVisible();

		// The front desk still offers to open its own, i.e. dining's did not stand in for it.
		await page.goto(`${staff}/front-desk`);
		await expect(
			page.getByPlaceholder('Float ₱').or(page.getByText(/Shift open · float/))
		).toBeVisible();

		// Tidy up so a rerun starts from a closed dining drawer.
		await page.goto(orders);
		await page.getByRole('button', { name: 'Close shift' }).click();
		await page.getByLabel('Counted cash').fill('300');
		await page.getByRole('dialog').getByRole('button', { name: 'Close shift' }).click();
		await expect(page.getByLabel('Opening float')).toBeVisible();
	});
});
