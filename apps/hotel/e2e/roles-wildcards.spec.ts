import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';

/**
 * The seeded Front Desk role holds `payment:*`/`shift:*`/`support:*`. Before the wildcard fix the
 * editor had no checkbox for those, so they rendered unchecked and a save that touched nothing
 * else wiped them — a cashier silently lost payments. These specs lock the round trip.
 */

const ROLES_URL = `/${SLUG}/management/settings/team/roles`;

/** The role card for a role by name — each is a <section> holding the name and its Edit button. */
function roleCard(page: import('playwright/test').Page, name: string) {
	return page.locator('section').filter({ hasText: name }).first();
}

/** Presses a button that opens a form in the browser, until the page has hydrated enough to hear it. */
async function pressUntil(page: import('playwright/test').Page, button: () => Promise<void>, form: import('playwright/test').Locator) {
	await expect(async () => {
		await button();
		await expect(form).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 30_000 });
}

async function openEditor(page: import('playwright/test').Page, name: string) {
	const card = roleCard(page, name);
	const form = card.locator('form[action="?/updateRole"]');
	await pressUntil(page, () => card.getByRole('button', { name: 'Edit' }).click(), form);
	return form;
}

test('a broader grant shows as ticked and survives an unrelated save', async ({ page }) => {
	await staffLogin(page);
	await page.goto(ROLES_URL);
	await expect(page.getByRole('heading', { name: 'Roles' })).toBeVisible();

	let form = await openEditor(page, 'Front Desk');
	const paymentsAll = form.locator('input[value="payment:*"]');
	await expect(paymentsAll).toBeChecked();

	// The single permissions that grant covers read as ticked but locked.
	const takePayments = form.locator('input[value="payment:create"]');
	await expect(takePayments).toBeChecked();
	await expect(takePayments).toBeDisabled();

	// Touch only the description.
	const stamp = `wildcard check ${Date.now()}`;
	await form.locator('input[name="description"]').fill(stamp);
	await form.getByRole('button', { name: 'Save role' }).click();
	await expect(page.getByText('Role updated.')).toBeVisible();

	// Reopen: the wildcard is still there.
	await expect(roleCard(page, 'Front Desk')).toContainText(stamp);
	form = await openEditor(page, 'Front Desk');
	await expect(form.locator('input[value="payment:*"]')).toBeChecked();
});

test('narrowing a broader grant to one permission still works', async ({ page }) => {
	await staffLogin(page);
	await page.goto(ROLES_URL);

	// A throwaway role, so the test never leaves a seeded role narrowed.
	const name = `E2E Caps ${Date.now().toString().slice(-6)}`;
	const create = page.locator('form[action="?/createRole"]');
	await pressUntil(page, () => page.getByRole('button', { name: 'Add role' }).click(), create);
	await create.locator('input[name="name"]').fill(name);
	await create.locator('input[value="payment:*"]').check();
	await create.getByRole('button', { name: 'Create role' }).click();
	await expect(page.getByText('Role created.')).toBeVisible();

	// Swap the wildcard for a single permission: unlocking the subsumed boxes as it clears.
	let form = await openEditor(page, name);
	await form.locator('input[value="payment:*"]').uncheck();
	const takePayments = form.locator('input[value="payment:create"]');
	await expect(takePayments).toBeEnabled();
	await expect(takePayments).not.toBeChecked();
	await takePayments.check();
	await form.getByRole('button', { name: 'Save role' }).click();
	await expect(page.getByText('Role updated.')).toBeVisible();

	form = await openEditor(page, name);
	await expect(form.locator('input[value="payment:*"]')).not.toBeChecked();
	await expect(form.locator('input[value="payment:create"]')).toBeChecked();
	await expect(form.locator('input[value="payment:record"]')).not.toBeChecked();

	// Clean up — nobody holds it, so it deletes outright.
	await roleCard(page, name).getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByText('Role deleted.')).toBeVisible();
});
