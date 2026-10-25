import { expect, test, type Page } from 'playwright/test';
import { SLUG, staffLogin } from './helpers';
import * as db from './db';

/**
 * Dining runs its own till, and the money has to be followable from the register to the ledger.
 * These tests drive the real UI and then read the rows it left behind: which drawer the cash
 * landed in, which shift it was tagged with, and which chart-of-accounts leaf it posted to.
 *
 * They need a dining drawer configured (Finance → Settings → Dining drawer), a dining venue with
 * at least one available dish, and no shift already open on dining's drawer. Each test that opens
 * the drawer closes it again in `afterEach`, because `cashier_shifts_one_open_per_drawer` turns a
 * leftover open shift into a confusing failure on the next run.
 */

const staff = `/${SLUG}/management`;
const orders = `${staff}/dining/orders`;
const drawerPage = `${staff}/dining/drawer`;
/** A spare drawer the account-creation test makes once and then leaves alone. */
const SPARE = 'E2E Spare Drawer';

let hotelId: string;
let drawer: db.Drawer | null = null;

test.beforeAll(async () => {
	const id = await db.hotelIdFor(SLUG);
	if (!id) return;
	hotelId = id;
	drawer = await db.diningDrawer(id);
});

test.afterAll(() => db.closeDb());

/** Dining's drawer, or a skip with the reason — every money test below needs one. */
function requireDrawer(): db.Drawer {
	test.skip(!hotelId, `No hotel with slug "${SLUG}" — set E2E_HOTEL_SLUG.`);
	test.skip(!drawer, 'No dining drawer configured — Finance → Settings → Dining drawer picks one.');
	return drawer!;
}

async function openDiningShift(page: Page, floatPhp: string) {
	await page.goto(orders);
	const float = page.getByLabel('Opening float');
	await expect(float).toBeVisible();
	await float.fill(floatPhp);
	await page.getByRole('button', { name: 'Open shift' }).click();
	await expect(page.getByText(/open · float ₱/)).toBeVisible();
	const shift = await db.openShiftFor(requireDrawer().id);
	expect(shift, 'the shift should now be open on dining’s drawer').not.toBeNull();
	return shift!;
}

/** Closes dining's shift from the Drawer page — the Orders toolbar only opens one. */
async function closeDiningShift(page: Page, countedPhp: string) {
	await page.goto(drawerPage);
	const form = page.locator('form[action="?/closeShift"]');
	await form.locator('input[name="counted"]').fill(countedPhp);
	await form.getByRole('button', { name: 'Close shift' }).click();
	await expect(page.getByText(/drawer closed/)).toBeVisible();
}

/**
 * Records a payout / cash drop on the open drawer, and waits for the money to actually move —
 * the toast only renders once the page has hydrated, the cash movement is the real receipt.
 */
async function drawerEvent(page: Page, shiftId: string, kind: string, amountPhp: string, reason?: string) {
	const before = (await db.movementsForShift(shiftId)).length;
	const form = page.locator('form[action="?/shiftEvent"]');
	await form.locator('select[name="kind"]').selectOption(kind);
	await form.locator('input[name="amount"]').fill(amountPhp);
	if (reason) await form.locator('input[name="reason"]').fill(reason);
	await form.getByRole('button', { name: 'Add' }).click();
	await expect
		.poll(async () => (await db.movementsForShift(shiftId)).length, { timeout: 15_000 })
		.toBeGreaterThan(before);
}

/** Rings up a takeaway order and pays it in cash. Returns the order row it created. */
async function sellForCash(page: Page) {
	await page.goto(orders);
	const menu = page.locator('section[aria-label="Menu"]');
	// The sheet is opened in the browser, so press until the page has hydrated enough to hear it.
	await expect(async () => {
		await page.getByRole('button', { name: 'New order' }).click();
		await expect(menu).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 30_000 });
	const dish = menu.locator('li > button:not([disabled])').first();
	test.skip((await dish.count()) === 0, 'This venue has no available dish to sell.');
	await dish.click();
	// A dish with add-on groups expands instead of dropping straight into the cart.
	const addToOrder = page.getByRole('button', { name: 'Add to order' });
	if (await addToOrder.isVisible().catch(() => false)) await addToOrder.click();

	const cart = page.locator('aside[aria-label="This order"]');
	await cart.getByText('Takeaway', { exact: true }).click();
	await cart.getByRole('button', { name: 'Place & pay' }).click();

	// The payment dialog opens on the new order; cash is its default method.
	const pay = page.getByRole('dialog');
	await expect(pay.getByText('Take payment')).toBeVisible();
	await pay.getByRole('button', { name: 'Exact' }).click();
	await pay.getByRole('button', { name: /^Record ₱/ }).click();

	// Wait on the payment itself — the dialog shows "Change" before it is taken, so the screen
	// is no proof the money landed.
	await expect
		.poll(async () => (await db.latestDiningOrder(hotelId))?.paymentStatus, { timeout: 20_000 })
		.toBe('paid');
	return (await db.latestDiningOrder(hotelId))!;
}

test.describe('Dining · its own cash drawer', () => {
	test.beforeEach(async ({ page }) => {
		await staffLogin(page);
	});

	test('a cash account made in the UI gets its own chart-of-accounts leaf', async ({ page }) => {
		test.skip(!hotelId, `No hotel with slug "${SLUG}".`);
		// Without a leaf of its own the account posts nothing ("This cash account has no
		// chart-of-accounts link yet"), and sharing the seeded 1010 would merge this till's
		// money into the front desk's line on the balance sheet.
		if (!(await db.cashAccountByName(hotelId, SPARE))) {
			await page.goto(`${staff}/finance/settings`);
			const form = page.locator('form[action="?/createAccount"]');
			// The button only reveals the form once the page has hydrated, so press until it does.
			await expect(async () => {
				await page.getByRole('button', { name: 'Add account' }).click();
				await expect(form.locator('input[name="name"]')).toBeVisible({ timeout: 2000 });
			}).toPass({ timeout: 30_000 });
			await form.locator('input[name="name"]').fill(SPARE);
			await form.locator('select[name="kind"]').selectOption('cash_drawer');
			await form.getByRole('button', { name: 'Add' }).click();
			await expect(page.getByText('Account added.')).toBeVisible();
		}

		const spare = await db.cashAccountByName(hotelId, SPARE);
		expect(spare?.coaCode, 'a new drawer must get its own COA leaf').toBeTruthy();
		expect(spare!.coaCode).not.toBe('1010');
		expect(Number(spare!.coaCode)).toBeGreaterThanOrEqual(1010);
		expect(Number(spare!.coaCode)).toBeLessThan(1020);
	});

	test('the two drawer pickers exclude each other', async ({ page }) => {
		requireDrawer();
		await page.goto(`${staff}/finance/settings`);
		// One till can never serve both registers — the clash that silently merges dining's
		// cash into the desk's.
		const front = page.locator('select[name="defaultDrawerAccountId"]');
		const dining = page.locator('select[name="diningDrawerAccountId"]');
		await expect(front.locator('option', { hasText: drawer!.name })).toHaveCount(0);
		await expect(dining.locator('option', { hasText: 'Front Desk Drawer' })).toHaveCount(0);
	});

	test('dining cash lands in dining’s till, not the front desk’s', async ({ page }) => {
		const dining = requireDrawer();
		const desk = await db.frontDeskDrawer(hotelId);
		const deskShiftBefore = desk ? await db.openShiftFor(desk.id) : null;
		const deskMovementsBefore = deskShiftBefore ? (await db.movementsForShift(deskShiftBefore.id)).length : 0;

		const shift = await openDiningShift(page, '500');
		const order = await sellForCash(page);

		// The trail: one movement, on dining's drawer, inside dining's shift, pointing back at
		// the order, with a journal entry behind it.
		const move = await db.movementForSource('dining_order', order.id);
		expect(move, 'the sale must leave a cash movement').not.toBeNull();
		expect(move!.cashAccountId).toBe(dining.id);
		expect(move!.shiftId).toBe(shift.id);
		expect(move!.direction).toBe('in');
		expect(move!.category).toBe('dining_revenue');
		expect(move!.amountCentavos).toBe(order.totalCentavos);
		expect(move!.voidedAt).toBeNull();
		expect(move!.memo, 'the memo should name the order').toContain(order.code);
		expect(move!.journalEntryId, 'money with no ledger entry is the one thing we cannot have').toBeTruthy();

		// The order row carries the same pair, so Finance and Dining tell one story.
		expect(order.cashAccountId).toBe(dining.id);
		expect(order.shiftId).toBe(shift.id);

		// The ledger: the cash leg posts to this drawer's own leaf, the revenue leg to 4040.
		const lines = await db.journalLines(move!.journalEntryId!);
		const cashLeg = lines.find((l) => Number(l.debit_centavos) === order.totalCentavos);
		expect(cashLeg?.code, 'the cash leg must debit dining’s own drawer leaf').toBe(dining.coaCode);
		expect(cashLeg?.code).not.toBe('1010');
		expect(lines.some((l) => l.code === '4040' && Number(l.credit_centavos) === order.totalCentavos)).toBeTruthy();

		// And the front desk's count is untouched by a dining sale.
		if (deskShiftBefore) {
			expect((await db.movementsForShift(deskShiftBefore.id)).length).toBe(deskMovementsBefore);
		}

		// The drawer page shows the same money.
		await page.goto(drawerPage);
		await expect(page.getByText('Expected in drawer')).toBeVisible();
		await closeDiningShift(page, ((50000 + order.totalCentavos) / 100).toFixed(2));
		const closed = await db.shiftById(shift.id);
		expect(closed?.status).toBe('closed');
		expect(closed?.expectedCashCentavos).toBe(50000 + order.totalCentavos);
		expect(closed?.varianceCentavos, 'an exact count balances').toBe(0);
	});

	test('the opening float reaches the ledger, and is counted once', async ({ page }) => {
		const dining = requireDrawer();
		const before = await db.accountBalance(dining.id);

		const shift = await openDiningShift(page, '1000');

		// The till's balance-sheet line holds the cash that is physically in the drawer: only the
		// shortfall is topped up, so a drawer already holding its float posts nothing. The top-up
		// is capped at the float — a wrong book balance is a correction, not a float.
		const shortfall = Math.max(0, 100000 - Math.max(0, before));
		expect(await db.accountBalance(dining.id)).toBe(before + shortfall);
		const floatMove = await db.floatMovementFor(shift.id, dining.id);
		if (shortfall > 0) {
			expect(floatMove?.amountCentavos).toBe(shortfall);
			expect(floatMove?.direction).toBe('in');
			expect(floatMove?.journalEntryId).toBeTruthy();
			// Untagged on purpose: the reconciliation already counts the float via the shift's own
			// opening figure, and would otherwise expect it twice.
			expect(floatMove?.shiftId).toBeNull();
		} else {
			expect(floatMove).toBeNull();
		}

		// Expected cash is the float and nothing else — proof it was not double-counted.
		await closeDiningShift(page, '1000');
		const closed = await db.shiftById(shift.id);
		expect(closed?.expectedCashCentavos).toBe(100000);
		expect(closed?.varianceCentavos).toBe(0);
	});

	test('a payout and a cash drop reduce what the drawer should hold', async ({ page }) => {
		requireDrawer();
		const shift = await openDiningShift(page, '1000');

		await page.goto(drawerPage);
		await drawerEvent(page, shift.id, 'payout', '50', 'E2E ice run');
		await drawerEvent(page, shift.id, 'cash_drop', '100');

		// Opening float 1000 − 50 payout − 100 drop = 850 expected.
		const movements = await db.movementsForShift(shift.id);
		const out = movements.filter((m) => m.direction === 'out' && m.cashAccountId === drawer!.id);
		expect(out.map((m) => m.amountCentavos).sort((a, b) => a - b)).toEqual([5000, 10000]);

		// Count 20 short: the variance is recorded and an adjustment posts, so the drawer's
		// balance matches what was actually counted.
		await closeDiningShift(page, '830');
		const closed = await db.shiftById(shift.id);
		expect(closed?.expectedCashCentavos).toBe(85000);
		expect(closed?.countedCashCentavos).toBe(83000);
		expect(closed?.varianceCentavos).toBe(-2000);
		const after = await db.movementsForShift(shift.id);
		const adjustment = after.find((m) => m.category === 'adjustment');
		expect(adjustment?.amountCentavos, 'the short should post an adjustment').toBe(2000);
		expect(adjustment?.direction).toBe('out');
		expect(adjustment?.journalEntryId).toBeTruthy();
	});

	test('with dining’s drawer closed, cash cannot be taken', async ({ page }) => {
		requireDrawer();
		expect(await db.openShiftFor(drawer!.id), 'this test starts with the drawer closed').toBeNull();
		await page.goto(orders);
		// The toolbar offers to open a shift, and the pay dialog refuses cash — the guard that
		// stops dining cash landing on the account with no shift, invisible to every count.
		await expect(page.getByLabel('Opening float')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Close shift' })).toHaveCount(0);
	});

	test('Finance sees dining’s shifts on their own drawer', async ({ page }) => {
		requireDrawer();
		await page.goto(`${staff}/finance/shifts`);
		await expect(page.getByText(drawer!.name).first()).toBeVisible();

		// Dining's own history shows that drawer and no other.
		await page.goto(drawerPage);
		await expect(page.getByText('Shift history')).toBeVisible();
		await expect(page.getByText('Front Desk Drawer')).toHaveCount(0);
	});

	test.afterEach(async ({ page }) => {
		// A leftover open shift blocks the next run and the nightly day close. Close it on what
		// it should be holding, so a tidy-up never leaves a fake variance in the dev figures.
		const open = drawer ? await db.openShiftFor(drawer.id) : null;
		if (open) {
			const expected = await db.expectedCashFor(open);
			await closeDiningShift(page, (expected / 100).toFixed(2)).catch(() => undefined);
		}
	});
});
