import { expect, test, type Page } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';

/**
 * Settings as one navigable area: a grouped rail on desktop, a selector on phones, entries gated by
 * the same capabilities as their pages, and no visible link that ends in a 403.
 *
 * Prerequisites: the default manager account (hotel admin). The restricted-role test runs only when
 * E2E_DINING_EMAIL / E2E_DINING_PASSWORD point at an account whose role is the seeded "dining" role.
 */

const SETTINGS = `/${SLUG}/management/settings`;
const rail = (page: Page) => page.getByRole('navigation', { name: 'Settings' });

test.describe('settings navigation', () => {
	test('manager sees every group and each entry opens with the rail still present', async ({ page }) => {
		await staffLogin(page);
		await page.goto(SETTINGS);

		for (const group of ['Property', 'Rates & sales', 'Dining & kitchen', 'Finance & tax', 'People', 'System']) {
			await expect(rail(page).getByText(group, { exact: true })).toBeVisible();
		}

		// Pages that live under /settings keep the rail.
		for (const label of ['General', 'Branding & website', 'Check-in & check-out', 'Rates & policies', 'Team', 'Audit log']) {
			await rail(page).getByRole('link', { name: label }).click();
			await expect(page).toHaveURL(new RegExp(`/${SLUG}/management/settings/`));
			await expect(rail(page)).toBeVisible();
			await expect(rail(page).locator('[aria-current="page"]')).toContainText(label);
		}
	});

	test('"Roles & permissions" is not also highlighted as "Team"', async ({ page }) => {
		await staffLogin(page);
		await page.goto(`${SETTINGS}/team/roles`);
		const current = rail(page).locator('[aria-current="page"]');
		await expect(current).toHaveCount(1);
		await expect(current).toContainText('Roles & permissions');
	});

	test('link-out entries open the page in its own module', async ({ page }) => {
		await staffLogin(page);
		await page.goto(SETTINGS);
		await rail(page).getByRole('link', { name: 'Venues & page' }).click();
		await expect(page).toHaveURL(new RegExp(`/${SLUG}/management/dining/settings`));
		await page.goto(SETTINGS);
		await rail(page).getByRole('link', { name: 'Kitchen stations' }).click();
		await expect(page).toHaveURL(new RegExp(`/${SLUG}/management/kitchen/stations`));
	});

	test('the audit log is inside Settings and no longer a separate sidebar item', async ({ page }) => {
		await staffLogin(page);
		await page.goto(`/${SLUG}/management/dashboard`);
		await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Settings', exact: true }).first()).toBeVisible();
	});

	test('General holds the hotel details that used to sit in Finance settings', async ({ page }) => {
		await staffLogin(page);
		await page.goto(`${SETTINGS}/general`);
		await expect(page.getByLabel('VAT %')).toBeVisible();
		await expect(page.getByLabel('Timezone')).toBeVisible();
		await page.goto(`/${SLUG}/management/finance/settings`);
		await expect(page.getByLabel('VAT %')).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Settings → General' })).toBeVisible();
	});

	test('a phone shows one selector instead of the rail', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 800 });
		await staffLogin(page);
		await page.goto(SETTINGS);
		await expect(rail(page)).toBeHidden();
		const jump = page.getByLabel('Go to a settings page');
		await expect(jump).toBeVisible();
		await jump.selectOption({ label: 'Team' });
		await expect(page).toHaveURL(new RegExp(`/${SLUG}/management/settings/team`));
	});

	test('a dining-only account sees only its own entries and no link ends in a 403', async ({ page }) => {
		const email = process.env.E2E_DINING_EMAIL;
		const password = process.env.E2E_DINING_PASSWORD;
		test.skip(!email || !password, 'Set E2E_DINING_EMAIL and E2E_DINING_PASSWORD to run this check.');

		await page.goto(`/${SLUG}/management/login`);
		await page.locator('#email').fill(email!);
		await page.locator('input[name="password"]').fill(password!);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page).toHaveURL(/\/management\//);

		await page.goto(SETTINGS);
		await expect(rail(page).getByRole('link', { name: 'Menu' })).toBeVisible();
		await expect(rail(page).getByRole('link', { name: 'Add-ons' })).toBeVisible();
		await expect(rail(page).getByRole('link', { name: 'Floor layout & QR codes' })).toBeVisible();
		// Admin-only entries are not offered.
		for (const label of ['Venues & page', 'Branding & website', 'Payments & email', 'Team', 'Audit log']) {
			await expect(rail(page).getByRole('link', { name: label })).toHaveCount(0);
		}

		// Every offered link opens (nothing the nav shows is a dead end).
		const hrefs = await rail(page).getByRole('link').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
		for (const href of hrefs) {
			const res = await page.goto(href);
			expect(res?.status(), href).toBeLessThan(400);
		}
	});
});
