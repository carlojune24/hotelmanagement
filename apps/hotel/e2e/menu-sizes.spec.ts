import { expect, test } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import { closeDb, sql } from './db';

/**
 * Sizes: a dish sold as 8oz / 12oz / 16oz (or "Good for 1–6") where the chosen size's price IS the
 * dish's price, not an extra on top. Staff build a "Sizes" add-on group, attach it to a new dish, and
 * the guest order page prices the line by the size picked.
 *
 * Prerequisites: the hotel's first dining venue takes online orders (it is the default venue on the
 * Add-ons, Menu and order pages). Each run makes its own uniquely named group and dish.
 */

const run = Date.now().toString(36);
const GROUP = `E2E Coffee size ${run}`;
const DISH = `E2E Coffee ${run}`;

test('a size sets the dish price, and the guest must pick one', async ({ page }) => {
	await staffLogin(page);

	// 1 Staff: a "Sizes" group with three full prices
	await page.goto(`/${SLUG}/management/dining/addons`);
	await page.getByRole('button', { name: 'New group' }).click();
	await page.locator('#groupName').fill(GROUP);
	await page.getByRole('checkbox', { name: /Sizes: each option has its own full price/ }).click();
	await expect(page.locator('#groupMin')).toBeHidden(); // a size group is always "pick exactly one"
	await page.getByRole('button', { name: 'Create' }).click();

	const group = page.getByRole('region', { name: GROUP });
	await expect(group.getByText(/Sizes · pick 1/)).toBeVisible();
	for (const [name, php] of [['8oz', '100'], ['12oz', '120'], ['16oz', '140']]) {
		await group.getByLabel('Add an option').fill(name);
		await group.getByLabel('Price (₱)').fill(php);
		await group.getByRole('button', { name: 'Add' }).click();
		await expect(group.getByText(name, { exact: true })).toBeVisible();
	}
	await expect(group.getByText('₱120.00')).toBeVisible(); // a full price, not "+₱120.00"

	const [g] = await sql<{ setsPrice: boolean; minChoices: number; maxChoices: number }[]>`
		select sets_price as "setsPrice", min_choices as "minChoices", max_choices as "maxChoices"
		from dining_addon_groups where name = ${GROUP}`;
	expect(g).toEqual({ setsPrice: true, minChoices: 1, maxChoices: 1 });

	// 2 Staff: a dish that offers the sizes (its own price is never charged once a size is picked)
	await page.goto(`/${SLUG}/management/dining/menu`);
	await page.getByRole('button', { name: 'New item' }).click();
	await page.locator('#itemName').fill(DISH);
	await page.locator('#itemPrice').fill('1');
	await page.getByRole('checkbox', { name: new RegExp(GROUP) }).click();
	await page.getByRole('button', { name: 'Add item' }).click();
	await expect(page.getByText(DISH).first()).toBeVisible();

	// 3 Guest: the card shows the cheapest size, a size is required, and the total uses the size price
	await page.goto(`/${SLUG}/dining/order`);
	const dish = page.locator('.order-dish', { hasText: DISH });
	test.skip((await dish.count()) === 0, 'The new dish is not on the online order page (first venue does not take online orders?).');
	await expect(dish.getByText('from ₱100.00')).toBeVisible();

	await dish.locator('button.order-row').click();
	await dish.getByRole('button', { name: 'Add to order' }).click();
	await expect(dish.getByRole('alert')).toContainText(`choose an option for "${GROUP}"`);

	await dish.getByText('12oz').click();
	await dish.getByRole('button', { name: 'More' }).click(); // quantity 2
	await dish.getByRole('button', { name: 'Add to order' }).click();
	// 2 × ₱120 = ₱240, not 2 × (₱1 + ₱120)
	await expect(page.getByRole('button', { name: /^Review order · ₱240\.00/ }).first()).toBeVisible();
});

test('sizes typed on the dish itself: Biryani good for 2 / 4 / 6', async ({ page }) => {
	const biryani = `E2E Biryani ${run}`;
	await staffLogin(page);
	await page.goto(`/${SLUG}/management/dining/menu`);
	await page.getByRole('button', { name: 'New item' }).click();
	await page.locator('#itemName').fill(biryani);
	await page.getByRole('radio', { name: 'Sold in sizes' }).click();
	await expect(page.locator('#itemPrice')).toBeHidden(); // the one-price box gives way to the size list
	await page.getByRole('button', { name: 'Add a size' }).click(); // starts with 2 rows, now 3
	for (const [i, [name, php]] of [['Good for 2', '350'], ['Good for 4', '650'], ['Good for 6', '900']].entries()) {
		await page.getByLabel(`Size ${i + 1} name`).fill(name);
		await page.getByLabel(`Size ${i + 1} price`).fill(php);
	}
	await page.getByRole('button', { name: 'Add item' }).click();
	const row = page.locator('li', { hasText: biryani }).first();
	await expect(row.getByText('Good for 2 · Good for 4 · Good for 6')).toBeVisible();
	await expect(row.getByText('from ₱350.00')).toBeVisible();

	// The dish's own sizes stay off the Add-ons page and off other dishes' add-on lists
	const [g] = await sql<{ name: string; setsPrice: boolean }[]>`
		select g.name, g.sets_price as "setsPrice" from dining_addon_groups g
		join dining_menu_items m on m.id = g.menu_item_id where m.name = ${biryani}`;
	expect(g).toEqual({ name: 'Size', setsPrice: true });
	await page.goto(`/${SLUG}/management/dining/addons`);
	await expect(page.getByText('Good for 4')).toHaveCount(0);

	// Guest: pick "Good for 4", the line costs ₱650
	await page.goto(`/${SLUG}/dining/order`);
	const dish = page.locator('.order-dish', { hasText: biryani });
	test.skip((await dish.count()) === 0, 'The new dish is not on the online order page.');
	await expect(dish.getByText('from ₱350.00')).toBeVisible();
	await dish.locator('button.order-row').click();
	await dish.getByText('Good for 4').click();
	await dish.getByRole('button', { name: 'Add to order' }).click();
	await expect(page.getByRole('button', { name: /^Review order · ₱650\.00/ }).first()).toBeVisible();
});

test.afterAll(() => closeDb());
